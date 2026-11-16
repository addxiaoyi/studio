import pathlib
import unittest


WORKFLOW = pathlib.Path(__file__).parents[2] / ".github/workflows/agent-closure-ci.yml"


class AgentClosureCiConfigTests(unittest.TestCase):
    def test_video_reservation_recovery_runs_with_billing_regressions(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("test/fashion-generation.test.ts test/studio-video-generation.test.ts", workflow)

    def test_real_settlement_ledger_is_required_by_the_database_gate(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("node scripts/test-local-postgres.mjs src/runtime/billing-reconciliation.postgres.test.ts", workflow)

    def test_real_worker_process_recovery_runs_with_the_database_gate(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(
            "node scripts/test-local-postgres.mjs src/runtime/worker-process.postgres.test.ts",
            workflow,
        )

    def test_agent_run_lease_postgres_gate_is_not_optional(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("src/local-db/agent-run-lease.postgres.test.ts", workflow)
        self.assertIn("HELT_TEST_DATABASE_URL", workflow)
        self.assertIn("postgres:16", workflow)


if __name__ == "__main__":
    unittest.main()
