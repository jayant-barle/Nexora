# Agent rules for Nexora

1. Scope. Build only the stage that is active in docs/TEST_PLAN.md. Do not add features that PRD.md does not list.

2. Safety rules. These must never be broken:
   - Never delete a user file.
   - Never overwrite a file. Add a numeric suffix instead.
   - Show a preview before any move.
   - Compute SHA-256 before and after each move. If they differ, stop the run and report the file.
   - Write a log entry for every move, so the run can be undone.
   - Refuse moves between drives in stage 1.
   - Never use file created or modified dates to place a file.

3. Stop rules. Stop and report, do not continue, when:
   - A test fails.
   - PRD.md "Open items" has a decision that the code needs.
   - git status is not clean at the start of a stage.
   - An action would delete or change a file outside the project or the test folder.

4. Tests. Every test that touches files uses a temporary folder. No automated test may read or write a real photo folder.

5. Evidence. Run every test and command before reporting it works. Paste the output. Do not describe a result you did not see.

6. Decisions. Add every new decision to docs/DECISIONS.md with today's date.

7. Commits. One commit per logical change. Commit messages start with the stage name, for example "Stage 1: name rule". Do not push unless the owner says so.

8. Versions. At the end of each stage, bump VERSION and add an entry to CHANGELOG.md.
