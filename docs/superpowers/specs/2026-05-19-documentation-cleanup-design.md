# Documentation Cleanup Design

**Date**: 2026-05-19  
**Status**: Design Approved  
**Scope**: Consolidate and archive dispersed documentation; remove orphaned/redundant files.

---

## Problem Statement

The repository contains documentation spread across multiple locations with unclear relationships:
- `docs/phase-2-tools-design/` and `docs/phase-3-memory/` contain exploratory planning docs (class notes, session-based work) that are not actively maintained
- `DIAGRAMA_HITL_FLOW.md` at root duplicates content already in `docs/architecture.md`
- `CHANGELOG.md` is an unmaintained template with no actual entries
- Unclear which docs are "active" vs "historical" for a new developer joining the project

**Impact**: Confusion when navigating docs, unclear what's current, redundant information, wasted time reading outdated material.

---

## Solution: Archive + Aggressive Cleanup

### Final Documentation Structure

```
root/
├── README.md                         ← Setup + quick start (KEEP, VERIFY CURRENT)
├── CLAUDE.md                         ← Instructions for Claude Code (KEEP)
├── LICENSE                           ← MIT (KEEP)
├── package.json, turbo.json, etc.    ← Config (KEEP)
│
├── docs/
│   ├── brief.md                      ← Product vision (KEEP, VERIFY CURRENT)
│   ├── architecture.md               ← Technical arch + HITL flow (KEEP, VERIFY CURRENT)
│   ├── plan.md                       ← Implementation phases (KEEP, VERIFY CURRENT)
│   ├── github-integration.md         ← GitHub OAuth flow (KEEP)
│   │
│   └── archive/
│       ├── README.md                 ← Explanation of archive contents (NEW)
│       ├── phase-2-tools-design/     ← Class notes, exploratory (MOVED)
│       └── phase-3-memory/           ← Class notes, exploratory (MOVED)
│
└── apps/, packages/                  ← Source code (KEEP)
```

### Files to Delete from Root
- `CHANGELOG.md` — Unmaintained template, no real entries
- `DIAGRAMA_HITL_FLOW.md` — Content merged into `docs/architecture.md`

### Pre-Archive Validation

Before archiving `phase-2-tools-design/` and `phase-3-memory/`:
1. Quick scan for **unique information** not already in active docs (brief, architecture, plan)
2. If valuable content found → extract and consolidate into active docs
3. If only exploratory notes → move to archive as-is
4. Create `docs/archive/README.md` explaining these are historical/exploratory

### Documentation Quality Checks

**README.md:**
- Reflects current state of the code (Node 20, Turbo, workspaces, Next.js 16, etc.)
- Setup instructions are correct and tested workflow
- Remove redundancy with brief.md
- Keep it concise: setup + quick start + link to docs

**docs/brief.md:**
- Matches current architecture (Next.js, Supabase, LangGraph, OpenRouter)
- Problem statement and MVP examples are still valid
- No overlap with architecture.md (which is more technical)
- Concise product vision, not implementation details

**docs/architecture.md:**
- Includes HITL flow diagram (from DIAGRAMA_HITL_FLOW.md)
- All tech stack details current
- Clear component boundaries
- Data flow documented

---

## Implementation Steps

1. ✅ Create `docs/archive/` directory
2. ✅ Create `docs/archive/README.md` (explanation of what's there)
3. ✅ Move `docs/phase-2-tools-design/` → `docs/archive/phase-2-tools-design/`
4. ✅ Move `docs/phase-3-memory/` → `docs/archive/phase-3-memory/`
5. ✅ Scan phase-2 and phase-3 docs for unique content → consolidate if found
6. ✅ Delete `CHANGELOG.md` from root
7. ✅ Delete `DIAGRAMA_HITL_FLOW.md` from root (content preserved in architecture.md)
8. ✅ Verify README.md is current and concise
9. ✅ Verify docs/brief.md is current and focused
10. ✅ Verify docs/architecture.md includes all relevant diagrams
11. ✅ Commit changes with message: "docs: archive exploratory phase docs and remove redundant files"

---

## Success Criteria

- [ ] Root directory has no orphaned `.md` files (only README.md, CLAUDE.md, LICENSE)
- [ ] `docs/` contains only active docs: brief, architecture, plan, github-integration
- [ ] `docs/archive/` exists with clear README explaining its purpose
- [ ] README.md and brief.md have no redundant sections
- [ ] HITL flow diagram present in architecture.md
- [ ] New developer can navigate docs easily and understand what's current vs historical
- [ ] All changes committed and reviewed

---

## Trade-offs

**Benefit**: Clean, focused documentation; clear hierarchy (active vs historical); easier to maintain and update.

**Cost**: Phase-2 and Phase-3 docs moved to archive (not deleted); if needed, they're in `git log` and accessible via git history.

---

## Notes

- No code changes; pure documentation reorganization
- All changes reversible via git
- No impact on build, tests, or runtime
