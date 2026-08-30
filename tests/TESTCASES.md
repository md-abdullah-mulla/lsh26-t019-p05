# SQA test cases — কিস্তি খাতা

Run: `npm test`

| ID | Area | Steps | Expected |
|---|---|---|---|
| TC-M01 | Money | Parse 0, 1, 312, 550.75, 1.5 | Integer paisa, no floats |
| TC-M02 | Money | "", abc, 12.345, 1.2.3, --1 | All rejected |
| TC-M03 | Dates | first_due + 7 days | Next week due date |
| TC-M04 | Dates | formatDate en / bn | Aug vs আগস্ট |
| TC-L01 | Engine | selfTest() | Pass |
| TC-L02 | B01 | As of 23 Aug, no payments | W1 overdue ৳750, W2 due today not overdue |
| TC-L03 | B02 | FIFO 5 payments | W1–W3 paid, W4 part ৳275.75, overdue ৳824.25 |
| TC-L04 | B12 | Prepaid, first due today | Overdue 0 |
| TC-L05 | Dashboard | PUB-01 | Given 144,235 · collected 75,630.25 · overdue 18,477.75 · top amount B16 · top weeks B13 (7) |
| TC-L06 | As-of | Payment after as-of | Not applied |
| TC-L07 | Overpay | ৳1200 on ৳1000 face | Surplus ৳200, all weeks paid |
| TC-L08 | Same day | 100 then 150 | Both hit week 1 |
| TC-L09 | Due today | Unpaid due = as-of | Overdue 0; next day overdue |
| TC-L10 | Public | 25 cases, 518 loans | Plan exact, conservation, FIFO, overdue only if due < today |
| TC-A01 | Post/remove | Part 375.50, overpay, remove both | Overdue drops then restores |
| TC-A02 | Validation | Bad date, 0, garbage | Errors |
| TC-A03 | New member | Exact plan vs mismatch | ok / planMismatch / nameRequired |
| TC-A04 | What-if | 0% / 50% / 100% of overdue | PAR and leftover match formula |
| TC-A05 | Preview | ৳1000 on B01 | Hits W1 then W2; post matches |
| TC-A06 | Queue | pick + next overdue | Different member |
| TC-A07 | IDs | makeId | Unique B##-XXX |
| TC-A08 | Group | Shapla filter | Subset of portfolio |
| TC-A09 | Input | Empty and 1,250.50 | 0 and 125050 paisa |
| TC-A10 | Waterfall | ৳750 on B01 as of 30 Aug | W1 paid, W2 still overdue ৳750 |
| TC-I01 | i18n | bn vs en keys | Same set |
| TC-I02 | i18n | Every value | Non-empty; bn ≠ en (except language button labels) |
| TC-I03 | i18n | t(bn) / t(en) | Different nav/post labels |
| TC-I04 | i18n | Group names | শাপলা / Shapla |
| TC-I05 | i18n | Status | Paid/Part/Overdue/Due/Upcoming both languages |
| TC-I06 | i18n | app.js t("…") | Only known keys; lang buttons exist |
| TC-I07 | i18n | No stale English chrome | Dashboard / Record payment gone |
| TC-S01 | Seed | Count | ≥ 15 borrowers |
| TC-S02 | Seed | Cycles | Varied paid/overdue mix |
| TC-F01 | Fuzz | 200 random books | Conservation + FIFO |

## Manual UI checks (after `npm test`)

| ID | Steps | Expected |
|---|---|---|
| UI-01 | Click বাংলা then English | Every label switches; data unchanged |
| UI-02 | Center meeting → pick member → type 375.50 → Post | Confirmation; oldest week reduced |
| UI-03 | Note pad 1000+500 | Amount 1500.00, bars fill oldest first |
| UI-04 | Passbook → Remove a payment | Confirm; schedule recomputes |
| UI-05 | As of 23 Aug vs 30 Aug | Overdue changes; no crash |
| UI-06 | New member 10×550=5000+500 | Added; bad plan rejected in current language |
| UI-07 | Demo | Opens Parul, fills arrears, posts |
| UI-08 | What-if slider | PAR numbers update |
| UI-09 | Search | Filters members |
| UI-10 | Reset | Restores PUB-01 |
| UI-11 | Collection sheet → print / CSV | Totals match; file downloads |
| UI-12 | Enter posts, N next member, Esc closes | No alert() for amount errors |
| UI-13 | Bad amount on post | Red on-page error under the field |
| UI-14 | Sample cases / Open JSON | Loads official pack; case picker appears |
