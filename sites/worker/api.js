const API_BODY_LIMIT = 65536;
const LEAD_STAGES = new Set(["new", "contacted", "courier", "received", "paid", "lost"]);
const LEAD_FIELDS = new Set(["name", "telegram", "phone", "stage", "cards", "nextAction", "dueAt", "commission", "notes"]);
const TASK_FIELDS = new Set(["leadId", "title", "dueAt", "done"]);
const NOTE_FIELDS = new Set(["body", "text"]);

class ApiFault extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function fail(status, code, message, fields) {
  throw new ApiFault(status, code, message, fields);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function faultResponse(error) {
  const known = error instanceof ApiFault;
  const body = { error: {
    code: known ? error.code : "storage_error",
    message: known ? error.message : "Не удалось сохранить или загрузить данные. Попробуйте ещё раз.",
    ...(known && error.fields ? { fields: error.fields } : {}),
  } };
  return new Response(JSON.stringify(body), {
    status: known ? error.status : 500,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function textField(value, field, maxLength, required = false) {
  if (value == null && !required) return "";
  if (typeof value !== "string") fail(422, "validation_error", "Проверьте поля формы.", { [field]: "Ожидается текст." });
  const trimmed = value.trim();
  if ((required && !trimmed) || trimmed.length > maxLength) {
    fail(422, "validation_error", "Проверьте поля формы.", { [field]: required && !trimmed ? "Поле обязательно." : "Слишком длинное значение." });
  }
  return trimmed;
}

function dueDate(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    fail(422, "validation_error", "Укажите дату и время с часовым поясом.", { dueAt: "Ожидается дата ISO 8601." });
  }
  const [year, month, day, hour, minute, second = "0"] = value.slice(0, 19).split(/[-T:]/).map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > lastDay || hour > 23 || minute > 59 || second > 59) fail(422, "validation_error", "Некорректная дата.", { dueAt: "Некорректная дата." });
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) fail(422, "validation_error", "Некорректная дата.", { dueAt: "Некорректная дата." });
  return new Date(timestamp).toISOString();
}

function commissionValue(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1000000000000) {
    fail(422, "validation_error", "Некорректная комиссия.", { commission: "Число от 0 до 1 000 000 000 000." });
  }
  return Math.round((value + Number.EPSILON) * 100);
}

function cardList(value) {
  if (!Array.isArray(value) || value.length > 30) fail(422, "validation_error", "Допустимо до 30 карт.", { cards: "Ожидается массив карт." });
  return value.map((card) => {
    if (!card || Array.isArray(card) || typeof card !== "object") fail(422, "validation_error", "Некорректная карта.", { cards: "Ожидаются объекты bank/status." });
    return {
      bank: textField(card.bank, "cards.bank", 120, true),
      status: textField(card.status ?? "planned", "cards.status", 50, true),
    };
  });
}

function knownFields(input, allowed) {
  const unknown = Object.keys(input).filter((field) => !allowed.has(field));
  if (unknown.length) fail(422, "validation_error", "Переданы неизвестные поля.", { fields: unknown.join(", ").slice(0, 300) });
  if (!Object.keys(input).length) fail(422, "validation_error", "Нет данных для сохранения.");
}

function leadInput(input, existing = null) {
  knownFields(input, LEAD_FIELDS);
  const base = existing || { name: "", telegram: "", phone: "", stage: "new", cards: [], nextAction: "", dueAt: null, commission: 0, notes: "" };
  const next = { ...base };
  for (const [field, max] of [["name", 160], ["telegram", 80], ["phone", 60], ["nextAction", 500], ["notes", 10000]]) {
    if (Object.hasOwn(input, field)) next[field] = textField(input[field], field, max, field === "name");
  }
  if (!existing && !next.name) fail(422, "validation_error", "Укажите имя лида.", { name: "Поле обязательно." });
  next.telegram = next.telegram.replace(/^@/, "");
  if (Object.hasOwn(input, "stage")) {
    if (!LEAD_STAGES.has(input.stage)) fail(422, "validation_error", "Неизвестный этап.", { stage: "Выберите этап из списка." });
    next.stage = input.stage;
  }
  if (Object.hasOwn(input, "cards")) next.cards = cardList(input.cards);
  if (Object.hasOwn(input, "dueAt")) next.dueAt = dueDate(input.dueAt);
  if (Object.hasOwn(input, "commission")) next.commission = commissionValue(input.commission) / 100;
  return next;
}

function taskInput(input, existing = null) {
  knownFields(input, TASK_FIELDS);
  const next = { ...(existing || { leadId: null, title: "", dueAt: null, done: false }) };
  if (Object.hasOwn(input, "title")) next.title = textField(input.title, "title", 240, true);
  if (!existing && !next.title) fail(422, "validation_error", "Укажите задачу.", { title: "Поле обязательно." });
  if (Object.hasOwn(input, "leadId")) next.leadId = input.leadId == null || input.leadId === "" ? null : resourceId(input.leadId);
  if (Object.hasOwn(input, "dueAt")) next.dueAt = dueDate(input.dueAt);
  if (Object.hasOwn(input, "done")) {
    if (typeof input.done !== "boolean") fail(422, "validation_error", "Некорректный статус задачи.", { done: "Ожидается true или false." });
    next.done = input.done;
  }
  return next;
}

function resourceId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) fail(400, "invalid_id", "Некорректный идентификатор.");
  return value;
}

async function requestObject(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) fail(415, "unsupported_type", "Используйте application/json.");
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > API_BODY_LIMIT) fail(413, "body_too_large", "Размер запроса превышает 64 КБ.");
  if (!request.body) fail(400, "invalid_json", "Тело запроса пустое.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > API_BODY_LIMIT) {
        await reader.cancel();
        fail(413, "body_too_large", "Размер запроса превышает 64 КБ.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    const input = JSON.parse(text);
    if (!input || Array.isArray(input) || typeof input !== "object") fail(400, "invalid_json", "Ожидается JSON-объект.");
    return input;
  } catch (error) {
    if (error instanceof ApiFault) throw error;
    fail(400, "invalid_json", "Некорректный JSON.");
  } finally { reader.releaseLock(); }
}

function noteFromRow(row) {
  return { id: row.id, leadId: row.lead_id, body: row.body, text: row.body, createdAt: row.created_at };
}

function leadFromRow(row, noteHistory = []) {
  return {
    id: row.id, name: row.name, telegram: row.telegram, phone: row.phone,
    stage: row.stage, cards: JSON.parse(row.cards_json), nextAction: row.next_action,
    dueAt: row.due_at, commission: row.commission_kopecks / 100, notes: row.notes,
    createdAt: row.created_at, updatedAt: row.updated_at,
    noteHistory, note_count: noteHistory.length,
  };
}

function taskFromRow(row) {
  return {
    id: row.id, leadId: row.lead_id, title: row.title, dueAt: row.due_at,
    done: Boolean(row.done), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function statement(db, sql, values = []) {
  return db.prepare(sql).bind(...values);
}

async function rows(db, sql, values = []) {
  const result = await statement(db, sql, values).all();
  return result.results || [];
}

async function activeLead(db, ownerId, id) {
  const row = await statement(db, "SELECT * FROM crm_leads WHERE id = ? AND owner_id = ? AND archived_at IS NULL", [id, ownerId]).first();
  if (!row) fail(404, "not_found", "Лид не найден.");
  return row;
}

async function activeTask(db, ownerId, id) {
  const row = await statement(db, "SELECT * FROM crm_tasks WHERE id = ? AND owner_id = ? AND archived_at IS NULL", [id, ownerId]).first();
  if (!row) fail(404, "not_found", "Задача не найдена.");
  return row;
}

async function leadNotes(db, ownerId, id) {
  return (await rows(db, "SELECT n.* FROM crm_notes n JOIN crm_leads l ON l.id = n.lead_id AND l.owner_id = n.owner_id WHERE n.lead_id = ? AND n.owner_id = ? AND l.archived_at IS NULL ORDER BY n.created_at ASC, n.id ASC", [id, ownerId])).map(noteFromRow);
}

async function completeLead(db, ownerId, id) {
  const row = await activeLead(db, ownerId, id);
  return leadFromRow(row, await leadNotes(db, ownerId, id));
}

function leadValues(lead) {
  return [lead.name, lead.telegram, lead.phone, lead.stage, JSON.stringify(lead.cards),
    lead.nextAction, lead.dueAt, commissionValue(lead.commission), lead.notes];
}

async function createLead(db, ownerId, input) {
  const lead = leadInput(input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await statement(db, "INSERT INTO crm_leads (id, owner_id, name, telegram, phone, stage, cards_json, next_action, due_at, commission_kopecks, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [id, ownerId, ...leadValues(lead), now, now]).run();
  return completeLead(db, ownerId, id);
}

async function updateLead(db, ownerId, id, input) {
  const previous = leadFromRow(await activeLead(db, ownerId, id));
  const lead = leadInput(input, previous);
  const result = await statement(db, "UPDATE crm_leads SET name = ?, telegram = ?, phone = ?, stage = ?, cards_json = ?, next_action = ?, due_at = ?, commission_kopecks = ?, notes = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND archived_at IS NULL", [...leadValues(lead), new Date().toISOString(), id, ownerId]).run();
  if (!result.meta?.changes) fail(404, "not_found", "Лид не найден.");
  return completeLead(db, ownerId, id);
}

async function archiveLead(db, ownerId, id) {
  await activeLead(db, ownerId, id);
  const now = new Date().toISOString();
  await db.batch([
    statement(db, "UPDATE crm_leads SET archived_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND archived_at IS NULL", [now, now, id, ownerId]),
    statement(db, "UPDATE crm_tasks SET archived_at = ?, updated_at = ? WHERE lead_id = ? AND owner_id = ? AND archived_at IS NULL", [now, now, id, ownerId]),
  ]);
  return { ok: true };
}

async function createNote(db, ownerId, id, input) {
  knownFields(input, NOTE_FIELDS);
  if (Object.hasOwn(input, "body") && Object.hasOwn(input, "text") && input.body !== input.text) fail(422, "validation_error", "Поля body и text различаются.");
  const body = textField(input.body ?? input.text, "body", 10000, true);
  const note = { id: crypto.randomUUID(), leadId: id, body, text: body, createdAt: new Date().toISOString() };
  const result = await statement(db, "INSERT INTO crm_notes (id, owner_id, lead_id, body, created_at) SELECT ?, ?, id, ?, ? FROM crm_leads WHERE id = ? AND owner_id = ? AND archived_at IS NULL", [note.id, ownerId, body, note.createdAt, id, ownerId]).run();
  if (!result.meta?.changes) fail(404, "not_found", "Лид не найден.");
  await statement(db, "UPDATE crm_leads SET updated_at = ? WHERE id = ? AND owner_id = ? AND archived_at IS NULL", [note.createdAt, id, ownerId]).run();
  return note;
}

async function createTask(db, ownerId, input) {
  const task = taskInput(input);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const fields = [id, ownerId, task.leadId, task.title, task.dueAt, Number(task.done), now, now];
  let result;
  if (task.leadId) {
    result = await statement(db, "INSERT INTO crm_tasks (id, owner_id, lead_id, title, due_at, done, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM crm_leads WHERE id = ? AND owner_id = ? AND archived_at IS NULL)", [...fields, task.leadId, ownerId]).run();
  } else {
    result = await statement(db, "INSERT INTO crm_tasks (id, owner_id, lead_id, title, due_at, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", fields).run();
  }
  if (!result.meta?.changes) fail(404, "not_found", "Лид для задачи не найден.");
  return taskFromRow(await activeTask(db, ownerId, id));
}

async function updateTask(db, ownerId, id, input) {
  const task = taskInput(input, taskFromRow(await activeTask(db, ownerId, id)));
  const result = await statement(db, "UPDATE crm_tasks SET lead_id = ?, title = ?, due_at = ?, done = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND archived_at IS NULL AND (? IS NULL OR EXISTS (SELECT 1 FROM crm_leads WHERE id = ? AND owner_id = ? AND archived_at IS NULL))", [task.leadId, task.title, task.dueAt, Number(task.done), new Date().toISOString(), id, ownerId, task.leadId, task.leadId, ownerId]).run();
  if (!result.meta?.changes) fail(404, "not_found", "Задача или связанный лид не найдены.");
  return taskFromRow(await activeTask(db, ownerId, id));
}

async function archiveTask(db, ownerId, id) {
  const now = new Date().toISOString();
  const result = await statement(db, "UPDATE crm_tasks SET archived_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND archived_at IS NULL", [now, now, id, ownerId]).run();
  if (!result.meta?.changes) fail(404, "not_found", "Задача не найдена.");
  return { ok: true };
}

async function allLeads(db, ownerId) {
  const result = await db.batch([
    statement(db, "SELECT * FROM crm_leads WHERE owner_id = ? AND archived_at IS NULL ORDER BY updated_at DESC, id ASC", [ownerId]),
    statement(db, "SELECT n.* FROM crm_notes n JOIN crm_leads l ON l.id = n.lead_id AND l.owner_id = n.owner_id WHERE n.owner_id = ? AND l.archived_at IS NULL ORDER BY n.created_at ASC, n.id ASC", [ownerId]),
  ]);
  const history = new Map();
  for (const row of result[1].results || []) {
    if (!history.has(row.lead_id)) history.set(row.lead_id, []);
    history.get(row.lead_id).push(noteFromRow(row));
  }
  return (result[0].results || []).map((row) => leadFromRow(row, history.get(row.id) || []));
}

async function allTasks(db, ownerId) {
  return (await rows(db, "SELECT * FROM crm_tasks WHERE owner_id = ? AND archived_at IS NULL ORDER BY done ASC, (due_at IS NULL) ASC, due_at ASC, created_at DESC", [ownerId])).map(taskFromRow);
}

async function stateData(db, user) {
  const [leads, tasks] = await Promise.all([allLeads(db, user.id), allTasks(db, user.id)]);
  return { leads, tasks, integration: { telegramConnected: false }, user: { name: user.name || user.full_name || user.email || "Пользователь", email: user.email || "" } };
}

function requireMethod(method, allowed) {
  if (!allowed.includes(method)) fail(405, "method_not_allowed", "Метод запроса не поддерживается.");
}

async function leadCollection(request, db, ownerId) {
  requireMethod(request.method, ["GET", "POST"]);
  if (request.method === "GET") return jsonResponse(await allLeads(db, ownerId));
  return jsonResponse(await createLead(db, ownerId, await requestObject(request)), 201);
}

async function leadResource(request, db, ownerId, id) {
  requireMethod(request.method, ["GET", "PATCH", "DELETE"]);
  if (request.method === "GET") return jsonResponse(await completeLead(db, ownerId, id));
  if (request.method === "DELETE") return jsonResponse(await archiveLead(db, ownerId, id));
  return jsonResponse(await updateLead(db, ownerId, id, await requestObject(request)));
}

async function noteCollection(request, db, ownerId, id) {
  requireMethod(request.method, ["GET", "POST"]);
  if (request.method === "GET") {
    await activeLead(db, ownerId, id);
    return jsonResponse(await leadNotes(db, ownerId, id));
  }
  return jsonResponse(await createNote(db, ownerId, id, await requestObject(request)), 201);
}

async function taskCollection(request, db, ownerId) {
  requireMethod(request.method, ["GET", "POST"]);
  if (request.method === "GET") return jsonResponse(await allTasks(db, ownerId));
  return jsonResponse(await createTask(db, ownerId, await requestObject(request)), 201);
}

async function taskResource(request, db, ownerId, id) {
  requireMethod(request.method, ["PATCH", "DELETE"]);
  if (request.method === "DELETE") return jsonResponse(await archiveTask(db, ownerId, id));
  return jsonResponse(await updateTask(db, ownerId, id, await requestObject(request)));
}

async function dispatchApi(request, env, user, path) {
  const db = env.DB;
  if (path === "/api/state") {
    requireMethod(request.method, ["GET"]);
    return jsonResponse(await stateData(db, user));
  }
  if (path === "/api/leads") return leadCollection(request, db, user.id);
  if (path === "/api/tasks") return taskCollection(request, db, user.id);
  const notes = path.match(/^\/api\/leads\/([^/]+)\/notes$/);
  if (notes) return noteCollection(request, db, user.id, resourceId(decodeURIComponent(notes[1])));
  const lead = path.match(/^\/api\/leads\/([^/]+)$/);
  if (lead) return leadResource(request, db, user.id, resourceId(decodeURIComponent(lead[1])));
  const task = path.match(/^\/api\/tasks\/([^/]+)$/);
  if (task) return taskResource(request, db, user.id, resourceId(decodeURIComponent(task[1])));
  return null;
}

export async function handleApi(request, env, user) {
  const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  if (!path.startsWith("/api/")) return null;
  try {
    if (!user || typeof user.id !== "string" || !user.id) fail(401, "unauthorized", "Войдите через ChatGPT.");
    if (!env.DB) fail(503, "storage_unavailable", "Хранилище ещё не подключено.");
    return await dispatchApi(request, env, user, path);
  } catch (error) {
    if (error instanceof URIError) return faultResponse(new ApiFault(400, "invalid_id", "Некорректный идентификатор."));
    if (!(error instanceof ApiFault)) console.error("CRM storage request failed", path, error?.name || "Error");
    return faultResponse(error);
  }
}
