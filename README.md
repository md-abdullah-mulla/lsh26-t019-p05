# কিস্তি খাতা — Micro-Loan Repayment Ledger (P05)

- **Team ID:** LSH26-T019
- **Problem ID:** P05
- **Event start code:** LSH26-8490-C900 (see `EVENT.md`)
- **Live URL:** https://kisti-khata.vercel.app
- **Repository:** https://github.com/md-abdullah-mulla/lsh26-t019-p05 (public)

A village-center collection book. Payments are uneven. The ledger applies each payment to the **oldest unpaid weekly instalment first** and carries extra forward. Outstanding is true at borrower level and at group level.

## Setup and run

Node backend, no extra npm packages. Login, the book and payments live on the server (`data/book.json` locally, `/tmp/kisti-book.json` on Vercel).

```bash
npm start
# http://127.0.0.1:8080
```

First screen is **center login**:

- Name: any officer name (e.g. `Mina`)
- PIN: `2026` (typed in; **not printed on the login page**)

```bash
npm test
```

Expected: **58107+ passed, 0 failed, 39 test cases**, plus `server tests passed`.

API: `POST /api/login`, `GET /api/state`, `PATCH /api/state`, `POST /api/pay`, `DELETE /api/pay`, `POST /api/borrowers`, `POST /api/reset`, `POST /api/load-case`, `POST /api/logout`, `GET /api/health`.

## How sample data gets in (not hardcoded-only)

1. **Seeded on start** — PUB-01 (18 borrowers) so a judge can click immediately after login.
2. **About page → File** — open any JSON in the official case shape (`{ "today", "borrowers": [...] }` or `{ "cases": [...] }`).
3. **About page → official / pack sample** — tries `https://live.hackathon.lofistack.com/api/fixtures/P05?teamId=LSH26-T019`, then the bundled pack `data/P05_micro_loans_public.json`.

After a load, pick PUB-01 … PUB-25 from the case list on About. Sample / File / Reset / Demo are **not** on the meeting toolbar.

Public sample file: `data/P05_micro_loans_public.json`. Week `k` is due on `first_due + 7 × (k − 1)`. Money is taka strings; the engine uses integer paisa.

## Four required items

| # | Requirement | Where it is |
|---|---|---|
| 1 | ≥ 15 borrowers, each with loan, interest, weekly plan, different cycle point | Seed + any public case. Members table and center queue. |
| 2 | Record a payment of any amount on any date (part and over) | Center meeting: type or cash pad → **জমা করুন / Post payment**. Enter key posts. |
| 3 | Oldest unpaid week first; week-by-week paid / part / overdue | Passbook + week strip. Preview shows `W1 +… → W2 +…`. |
| 4 | Group dashboard: given out, collected, overdue; most overdue by amount and by weeks | **শাখার খাতা / Branch book**. |

PUB-01 as of 2026-08-23 (integer paisa):

| Given out | Collected | Overdue |
|---|---|---|
| 14,423,500 | 7,563,025 | 1,847,775 |

Top overdue by amount: B16. Top by weeks behind: B13 (7 weeks).

## Bonus

- **Likely finish date** from how the borrower actually pays, not the original last due.
- **Remove a payment** and the book recomputes; the log remains.
- **Collection sheet** for a chosen date: prior arrears + remaining kisti due that day, print and CSV.
- **Meeting close**: cash taken this sitting vs who is still behind.
- Officer login and a Node API so the book is not only in the browser.
- Bangla / English, phone and tablet layout.

## Keyboard

| Key | Action |
|---|---|
| Enter | Post (amount field or after a receipt → next member) |
| N | Next overdue member |
| Esc | Close receipt / dialog |

`D` does nothing (no demo post). Amount errors show **on the page** in red, not as `alert()`.

## Major decisions

- **Integer paisa only.** No floats in the ledger.
- **Payments are the source of truth.** Week status is always derived for the as-of date.
- **As-of is an input**, never wall-clock. A payment after as-of is stored but not applied.
- **Due today is not overdue.** Overdue money and overdue weeks count only `due < today`.
- **FIFO with no holes.** Extra never skips an unpaid week.
- **Bangla first**, English one click away. Same keys, no mixed chrome.
- **Server book + signed cookie + bearer token.** Posting goes through `/api/pay`. The PIN is not shown on the login screen.
- **Responsive CSS** (phone / tablet / desktop). No UI kit.

## Known limitations

- Persistence is a JSON file, not SQL. Local `data/book.json` is durable. On Vercel the file is `/tmp`, so a cold isolate may start from seed again. Login uses a signed cookie plus a session token, so a new isolate does not kick the officer out.
- Official live fixture API may fail in the browser (CORS). Bundled pack + file upload on About still load the official cases.
- Reversing a payment is delete-and-replay, not a signed correction slip.
- Collection-sheet “this week” is the instalment whose due date equals the chosen date.
- One shared book per deployment, not multi-officer merge.
- “Cash this meeting” is the current browser sitting; a refresh clears that tally (posted payments remain on the server).

## Approach and contributions

Approach: treat the register as a waterfall over a fixed week grid, then hang a meeting UI and a collection sheet on that engine, then put login and writes on a small Node API.

Registered members: team **LSH26-T019** (names as on the arena). This repository is P05 only.

## AI disclosure

Arena.ai Agent Mode was used to write, test and document the software, directed by the team. Disclosed as required.

## Licences

See `LICENSES.md`. No UI kit. Sample data from LofiStack Participant Release v2.1.
