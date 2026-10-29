"""Run with python3 sites/tests/schema_test.py. No external packages or data."""
from pathlib import Path
import sqlite3
import unittest

MIGRATION = Path(__file__).resolve().parents[1] / "drizzle" / "0000_affiliate_crm.sql"
STAMP = "2026-10-29T12:00:00.000Z"


class SchemaTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript(MIGRATION.read_text())
        self.db.executemany(
            "INSERT INTO crm_leads (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            [("alice-lead", "alice", "Алиса", STAMP, STAMP), ("bob-lead", "bob", "Боб", STAMP, STAMP)],
        )

    def tearDown(self):
        self.db.close()

    def test_notes_and_tasks_cannot_reference_another_owner(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO crm_notes (id, owner_id, lead_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
                ("n1", "alice", "bob-lead", "Cross owner", STAMP),
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO crm_tasks (id, owner_id, lead_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                ("t1", "alice", "bob-lead", "Cross owner", STAMP, STAMP),
            )

    def test_same_owner_link_and_unlinked_task_are_valid(self):
        self.db.execute(
            "INSERT INTO crm_notes (id, owner_id, lead_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
            ("n1", "alice", "alice-lead", "Заметка", STAMP),
        )
        self.db.execute(
            "INSERT INTO crm_tasks (id, owner_id, lead_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            ("t1", "alice", None, "Позвонить", STAMP, STAMP),
        )
        self.assertEqual(self.db.execute("SELECT count(*) FROM crm_notes").fetchone()[0], 1)
        self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_database_rejects_invalid_stage_money_json_and_task_done(self):
        for column, value in [
            ("stage", "injected"),
            ("commission_kopecks", -1),
            ("cards_json", "not-json"),
            ("cards_json", "{}"),
            ("name", ""),
        ]:
            with self.subTest(column=column, value=value), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(f"UPDATE crm_leads SET {column} = ? WHERE id = ?", (value, "alice-lead"))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO crm_tasks (id, owner_id, title, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                ("bad", "alice", "Task", 2, STAMP, STAMP),
            )

    def test_archive_keeps_history_and_hides_active_record(self):
        self.db.execute(
            "INSERT INTO crm_notes (id, owner_id, lead_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
            ("n1", "alice", "alice-lead", "Сохранить историю", STAMP),
        )
        self.db.execute(
            "UPDATE crm_leads SET archived_at = ? WHERE id = ? AND owner_id = ?",
            (STAMP, "alice-lead", "alice"),
        )
        self.assertEqual(self.db.execute(
            "SELECT id FROM crm_leads WHERE owner_id = ? AND archived_at IS NULL", ("alice",)
        ).fetchall(), [])
        self.assertEqual(self.db.execute("SELECT body FROM crm_notes WHERE id = 'n1'").fetchone()[0], "Сохранить историю")
        self.assertEqual(self.db.execute(
            "SELECT id FROM crm_leads WHERE owner_id = ? AND archived_at IS NULL", ("bob",)
        ).fetchall(), [("bob-lead",)])


if __name__ == "__main__":
    unittest.main()
