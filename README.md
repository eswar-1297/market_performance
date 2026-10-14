# Marketing Performance Tracker

A local tracker for the CloudFuze marketing team, built around **one sheet per month**: a row
per person, and a **Target / Achieved** pair under every column their team is measured on.
The team fills it in by hand as the month goes, and the review scores that same sheet — who
hit their targets, who fell short and by how much — so nothing is written up twice.

Teams, people and the starter columns come from the team's own spreadsheet and the
`Marketing_MBR_Templates New.pptx` August 2026 MBR.

---

## Running it

The data lives in Postgres. Point the server at one, then start the two halves.

**First time on a machine** — creates the database and writes `server/.env`:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-db.ps1
```

It asks for the password of the local PostgreSQL `postgres` account. Forgotten it?
`reset-postgres-password.ps1`, from an admin PowerShell, sets a new one. Using a database
somewhere else instead — Render, Neon, Supabase — paste its connection string into:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-db.ps1 -Remote
```

Either way `server/.env` ends up holding one line of `DATABASE_URL=postgres://…` and a
generated `JWT_SECRET`. It is gitignored.

**Then:**

```bash
cd server
npm install        # first run only
npm run seed       # first run only — teams, people and the starter columns
npm start          # http://localhost:4100

cd client
npm install        # first run only
npm run dev        # http://localhost:5180, hot reload while working on the UI
```

For everyday use just run `npm run build` in `client/` once — the server then serves the
built UI itself, so **http://localhost:4100** is the only address anyone needs. Or
double-click **`start.bat`**.

### Sign in

The whole team uses **one shared login**:

| Email | Password |
|---|---|
| `marketing@cloudfuze.com` | `Cloudfuze@123` |

The server creates this account the first time it starts. To change the password, use *My
Account*. This changes it for everybody. `SHARED_LOGIN_EMAIL` and `SHARED_LOGIN_PASSWORD` in
`server/.env` (or on Render) set the address and the first password. The password variable is
used only when the account is first created.

The people on the sheet (Pankaj, Rahul, …) are records, not logins. They are still listed under
*Members*, but they cannot sign in, and sessions they had open before the switch are signed out.

---

## Who can do what

The shared login has full access. Anyone signed in can fill in any row and add or remove extra
rows. They can add, rename or remove columns, log tasks for anyone using the *Person* picker,
and manage teams and members. Because the login is shared, the app cannot record which
individual made a change.

---

## The screens

### Monthly Sheet — where the work happens

One table per team. **A row per person, and a pair of boxes — Target and Achieved — under
every column that team is measured on.** Type straight into a box and it saves the moment you
click away or press Enter; the box flashes green. Values are free text on purpose, so "20%",
"ENT", "5" and "US, UK, Canada and APAC" are all fine.

The teams and columns are the team's own sheet, one for one:

| Team | People | Columns |
|---|---|---|
| Content Team | Pankaj, Aayushi, Rashmi, Preksha, Bhuvana | Leads, Business Size, Case studies, Blogs, Region, Revenue |
| PPC | Rahul | Leads, CPL ↓, Region, Business Size |
| SEO/GEO Team | Rahul, Narayana, Manisha, Anil | Traffic, **Newsletter** › open rate · click through rate, **Webinar** › no of registrations, Guest blog, Leads |
| Wordpress Team | Nirosh, Ashu | Core webvitals, 404 ↓, 301 ↓, Website performance |
| Design Team | Hari | No of images, Landing pages, Whitepapers, Case studies, Avg turn around time ↓ |

↓ marks a column where a lower number is the better result. A column can sit under a heading —
*open rate* and *click through rate* both under **Newsletter** — and each one still keeps its own
Target / Achieved pair.

**+ Add column** asks three things: the column name, whether it goes **on its own** or **under a
heading** (an existing one, or a new one you name there), and whether **lower is better**. A new
sub-column slots in beside the others under its heading rather than at the end of the sheet.

The lead changes them per team with **+ Add column**, or the ✎ / × buttons in a column
heading — ✎ renames, ↑/↓ flips which way counts as good, × removes it along with whatever was
filled in under it. Design and Business
Development is not on the sheet at all — its team is still there, below the five, with Raj and
Abhigna on it; say the word and it goes.

#### More than one row per person

One line per person is the default, but somebody who reports the same numbers several times
over — a line per region, segment or account — can have as many lines as they need. The **＋**
button next to a name asks *"Add another row for Pankaj Rai?"* and drops a blank line in under
that same name. Nothing to name or label: the extra lines sit under the person, and **×**
removes one along with what was filled in on it. Everyone keeps at least one row.

Rows belong to the person, not to a month, so extra lines stay there every month. The review
still treats them as one person — their hit rate covers all their rows.

**Somebody on two teams.** Rahul reports PPC numbers and SEO/GEO numbers, which are different
columns, so he has a line on each sheet. The lead does that with **+ Add person** in a team
header; the person keeps one account, and the review scores them once per team.

Three tiles count people tracked, boxes filled in and boxes still blank. The team buttons
filter the page to one team and show how much of each grid is done, so the lead can see at a
glance who has not filled theirs in. The name column stays put when you scroll sideways, and
⬇ Export gives the same grid as CSV, one block per team.

### Daily Tasks — what was worked on, day by day

**Daily log.** Each person records what they worked on. A task has a **date**, a **URL** (the
blog, landing page or post itself) and a **description** of what was done, with **attachments**
if needed. You need a URL or a description, or both. A bare `cloudfuze.com/blog/x` gets
`https://` added. One day can hold any number of tasks. The log opens on your own entries, and
pick whose log it is with *Person*. This browser remembers the choice, so each person picks
their own name once.

Attachments are capped at 10 MB each and are stored in Postgres, not on the server's disk, so
they survive a Render restart. Anyone signed in can download them.

**Monthly summary.** The whole month per person: days logged, tasks, URLs and attachments.
People who logged nothing are flagged *Nothing logged*. Click a person (or **Expand all**) to
see every URL and description they entered, by date. **⬇ Export** downloads every task for the
month as CSV, one line each. **Print / Save as PDF** gives a handout.

### Monthly Review — the month judged, not repeated

The review scores the sheet rather than reprinting it. Pick a month and it answers, in order:

1. **Four numbers** — % of targets achieved (and how many of how many), targets missed, how
   many **people fell short**, and how many targets had **nothing reported** at all.
2. **Teams, worst first** — a row per team with people, achieved / scored, missed, not
   reported, and a hit-rate bar, so it is obvious which team is behind.
3. **Who did not hit their targets** — a block per person with their hit rate and every miss
   spelled out: *CPL — target $470 · actual $537 — 88% of target*, or *No result* where
   nothing was reported.
4. **Hit everything they were given** — the people with a clean month.
5. **No targets on the sheet at all** — people with nothing filled in, so a blank row is never
   mistaken for a failure.

**Print / Save as PDF** drops the navigation for a handout, and "Other months on record" lists
every month that has something in it.

#### How a box is scored

| In the box | Verdict |
|---|---|
| Both numbers, in the column's direction | **Achieved** or **Missed**, with % of target — `7,000 → 7,500`, `$470 → $537`, commas, `$` and `%` all understood |
| Target set, result blank | **Nothing reported** — counted against the person, separately from a miss |
| Matching text (`US` vs `us`) | **Achieved** |
| Text that does not match (`ENT` vs `SMB`) | **Not comparable** — left out of the hit rate rather than called a miss |
| Both blank | Ignored |

Each column knows which way is good. `CPL`, `404` and `301` ship as **lower is better**; the
lead flips any column with the ↑ / ↓ button in its heading on the sheet, and a lower-is-better
column is labelled `↓ lower` for everyone.

### Setup *(lead only)*

- **Members** — add people, set designation, team, reporting line and access level; reset
  passwords; deactivate leavers without losing their history.
- **Teams** — rosters, each team's columns, and how much of this month's sheet is filled in;
  create, rename or recolour a team. The colour tints that team's button on the sheet.

---

## What was seeded

**5 teams** — SEO & PPC, Content Writers, Developers, Design, Business Development.

**16 accounts** — Arun Jyothi (lead); Venkata Rahul, Narayana Reddy, Anil, Manisha;
Pankaj Rai, Aayushi, Rashmi, Bhuvana, Preksha; Nirosh Reddy S L, Ashu Tiwary; Hari Rowlo;
Raj Patsamatla, Abhigna; plus a read-only stakeholder account.

**25 sheet columns** across the five teams, as listed above. Sheets themselves start empty —
the team fills in each month.

The August 2026 deck's key wins and the September targets are still in the database (`tasks`,
`targets`, `snapshots`) from the earlier ticket-based version, and the API routes that read
them are still mounted, but nothing in the UI shows them. That history is there if it is ever
wanted back; otherwise it is simply inert.

---

## Technical notes

- **Backend** — Node 22 + Express, Postgres via `pg`, JWT auth, bcrypt password hashing.
  Connection string in `DATABASE_URL`; the tables are created on boot if they are missing.
- **Frontend** — React 18 + Vite + React Router. No CSS framework, no chart library.
- **Scoring** — one function, `scoreCell` in `server/src/routes/scorecard.js`, feeds both the
  review endpoint and anything built on it later, so the UI never second-guesses a verdict.
- **The sheet** — three tables. `scorecard_fields` is one column of a team's sheet, with the
  heading it sits under (`group_name`) and which way is good (`direction`); `scorecard_rows` is
  one line — a person, optionally on another team's sheet, and optionally one of several lines
  for that person, so the shape carries across months; `scorecard_cells` holds `target` and
  `achieved` as text, unique on `(cycle, row_id, field_id)`. A person's first row is written the
  first time something is typed on it, so an untouched sheet stores nothing. The starter columns
  are inserted once, only when `scorecard_fields` is empty, so nothing ever overwrites the
  lead's edits.
- **Moving from the old SQLite version** — `npm run import-sqlite` copies teams, people (with
  their passwords), columns, rows and every filled-in box out of a `data.db` and into Postgres.
  It matches on names and emails, so running it twice updates rather than duplicates.
- **Months** — a month exists as soon as someone types in it; the month list is built from the
  cells themselves, so the review can only offer months that have something in them.
- **Port** — the API runs on **4100** (4000 was already taken on this machine). Override with
  the `PORT` environment variable; if you change it, update the dev proxy in
  `client/vite.config.js` to match.

---

## Putting it online (Render)

The repo carries a `render.yaml`, so Render can set the whole thing up itself: a Postgres
database and one web service that serves both the API and the built UI.

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, pick the repo, and it reads `render.yaml`.
3. Approve the plan and deploy. First boot creates the tables and seeds the teams, the people
   and the columns, so the sheet is ready to fill in.
4. Sign in with `marketing@cloudfuze.com` / `Cloudfuze@123` and **change that password** under
   *My Account* — the repo is public and that password is in this file.

What the blueprint sets up:

| | |
|---|---|
| Database | `marketing-sheet`, Postgres, free plan |
| Build | `cd client && npm ci && npm run build && cd ../server && npm ci --omit=dev` |
| Start | `cd server && npm run deploy` — seeds an empty database, fixes the layout, then serves |
| Health check | `/api/health` |
| `DATABASE_URL` | wired to the database automatically |
| `JWT_SECRET` | generated by Render |

Both the service and the database are on free plans. A free web service sleeps when idle and
restarts cold, which costs a few seconds on the next visit — nothing is lost, because the data
is in Postgres rather than on the instance.

**Render's free Postgres expires after 30 days.** When it does, create a free database
elsewhere — [Neon](https://neon.tech) does not expire — and set `DATABASE_URL` on the web
service to its connection string. No code change, and `npm run import-sqlite` or a `pg_dump`
carries the contents over.

To work against the deployed database from this machine, run
`setup-db.ps1 -Remote` and paste the database's external connection string.

### Back up your data

Everything is in Postgres, so a backup is a dump:

```bash
pg_dump "$DATABASE_URL" > marketing-backup.sql      # or the Render/Neon connection string
```

Restore with `psql "$DATABASE_URL" < marketing-backup.sql`. Hosted providers also keep their
own backups — Render and Neon both do daily ones.

### Start a fresh month

Nothing to do — pick the new month in the header picker and start typing. Last month's sheet
stays exactly as it was left.

### Reshape the sheet

`npm run restructure` in `server/` puts the teams, their order, and their columns back to the
layout in `src/restructure.js` — the team's own sheet — and puts Rahul on the PPC sheet as well
as SEO/GEO. It matches on names rather than ids, so it is safe to run again, and it will not
drop a column that has anything filled in under it (it says so instead).

### Reset everything

`npm run reseed` in `server/` rebuilds teams, members and the starter columns. Because rebuilding the teams would take the sheet with them, it **refuses to run** once
anything has been filled in, and tells you what to do instead. If you genuinely want to throw the sheet away, take a dump first, then:

```bash
node src/seed.js --force --wipe-sheet
```
