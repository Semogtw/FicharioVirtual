# Project Instructions for AI Agents

These instructions apply to AI-assisted development in this repository. Verify the current repository state, code, tests, and canonical documentation before changing behavior; do not treat stale plans or historical branches as the source of truth.

<!-- auto-preference-learner:start -->
## Learned working preferences

- In multi-session development, verify the live Git/GitHub state and continue from the most advanced real development branch; do not regress to a historical branch or stale handoff when newer work exists.
- While clear, low-risk work remains within the current objective, continue to the next useful task without asking whether to proceed or stopping after a trivial checkpoint.
- Create and push frequent coherent checkpoints so environment resets do not erase meaningful progress. If interruption is likely before a coherent checkpoint and repository policy permits it, prefer a clearly labeled WIP commit on a non-protected development branch over losing local work.
- Prefer local tests, builds, linters, and other local validation as the normal development loop. Install missing tooling when practical; if a required gate remains unavailable, record the exact blocker and continue independent resolvable work instead of treating the unavailable gate as a reason to stop all development.
- Keep documentation synchronized with meaningful behavior, architecture, validation, and continuation-state changes so another agent can safely resume from the repository itself.
- Use available plugins and integrations when they materially improve correctness, verification, or development efficiency; do not invoke them merely for ceremony.
<!-- auto-preference-learner:end -->
