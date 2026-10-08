# NewsPaper

A personal journal that looks and feels like a classic broadsheet newspaper.
**One newspaper = one month. One page = one day.** All of it sits on a wooden shelf in an Indian tea stall.

## Features

- **Sign in / create account.** Passwords are hashed with bcrypt, and the session is a JWT in an httpOnly cookie.
- **The shelf.** Your monthly newspapers stand on a shelf. A second tab, *Shared with me*, holds papers other people have shared with you.
- **Add button.** `+` adds a month on the shelf. Inside a newspaper, *Add day* gives you a fresh page for any day of that month.
- **Newspaper reader.** A broadsheet-style template with a blackletter masthead, dateline, lead story, photo, and columns. Turn pages with a 3D flip using the arrows, ← → keys, a swipe, or the day strip.
- **View first, edit if allowed.** Pages open read-only. Owners and editors get an **Edit** button:
  - Text and image placeholders are already on every new page
  - Add headlines, text boxes, photos, and lines
  - Drag (orange tab), resize (corner), change font, size, bold/italic, alignment, and 1–3 columns
  - Drop an image file onto the page, or double-click a photo box
  - Keyboard: `Ctrl/Cmd+S` saves, `Del` deletes, arrow keys nudge (Shift for 10px)
- **Sharing.** The owner shares a newspaper by username with *Can view* or *Can edit* access.
- **Collaboration (save & refresh).** Editors save their own changes. If someone else saved while you were editing, you choose to keep your version or load theirs.
- **PDF.** Choose one page, a few, or the whole month, then **Download PDF** or **Share…**. Share uses the phone or OS share sheet where the browser supports it.
- **Email notifications.** Every account has an email. When a newspaper is shared with you, you get an email and a 🔔 notification. Turn emails off under **Account** (the initial button on the shelf).
- **Reactions.** People a newspaper is shared with can react to each day's page (❤️ 😂 😮 😢 👏 ☕). The writer gets a 🔔 notification, and an email for the first reaction from each person on each page.
- **Writing streak.** The shelf shows how many days in a row you've written.
- **Works on phones.** Double-tap to zoom a page, swipe to turn pages, and "Add to Home Screen" to install it like an app.
- **Ambience.** An animated tea-stall scene with steam, flickering bulbs, swaying snack packets, and a marigold garland. It blurs when a newspaper is open.

## Run it

Requires **Node.js 18+**.

```bash
npm install
npm start
# open http://localhost:3000
```

For auto-reload while developing: `npm run dev`.

On start the server runs `db/schema.sql`, which adds any missing tables and columns (email, reactions, notifications). It never deletes data. You can also paste that file into the Supabase SQL editor yourself.

### Email setup

Copy `.env.example` to `.env` and fill in the SMTP settings. Gmail works with an App Password; Brevo, Resend and Mailgun SMTP also work. Without SMTP settings, emails are printed in the server log instead of sent.

### Configuration (environment variables)

| Variable     | Default                 | Purpose                                                       |
|--------------|-------------------------|---------------------------------------------------------------|
| `PORT`       | `3000`                  | HTTP port                                                     |
| `JWT_SECRET` | auto-generated in `data/` | Secret used to sign login cookies                          |
| `DATABASE_URL` | –                     | Supabase / Postgres connection string (required)              |
| `APP_URL`    | request host            | Public site address used in email links                       |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | – | Outgoing email |
| `NODE_ENV`   | –                       | Set `production` to mark cookies `Secure` (needs HTTPS)       |

The database and secret live in `data/`, which is git-ignored.

## Project structure

```
chai-chronicle/
├── server.js            Express app: API, static files, PDF libs
├── src/
│   ├── db.js            SQLite schema (users, newspapers, pages, shares)
│   ├── auth.js          register / login / logout / me + requireAuth
│   └── api.js           newspapers, pages (with conflict check), sharing
└── public/
    ├── index.html       Login
    ├── shelf.html       Newspaper shelf
    ├── paper.html       Reader + editor
    ├── css/style.css    Base UI, ambience, login, shelf
    ├── css/paper.css    Newspaper page, page flip, editor, modals
    └── js/
        ├── common.js    API client, toasts, modals, ripple
        ├── ambience.js  SVG tea-stall background
        ├── login.js
        ├── shelf.js
        ├── template.js  Page model, default layout, renderer, sanitiser
        ├── paper.js     Reader: flip, days, add day, share, rename
        ├── editor.js    Drag/resize/edit/save
        └── pdf.js       Page picker → PDF (html2canvas + jsPDF)
```

## API

All routes need a signed-in cookie except register and login.

| Method | Route | Who |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | anyone |
| GET | `/api/auth/me` | signed in |
| GET / POST | `/api/papers` | list (`mine` + `shared`) / create a month |
| GET / PATCH / DELETE | `/api/papers/:id` | viewer / editor / owner |
| POST | `/api/papers/:id/pages` | editor (add a day) |
| PUT / DELETE | `/api/pages/:pid` | editor (save sends `baseUpdatedAt`; a mismatch returns 409) |
| GET / POST | `/api/papers/:id/shares` | owner |
| DELETE | `/api/papers/:id/shares/:uid` | owner, or the user leaving |
| PATCH | `/api/auth/me` | update name, email, email notifications |
| PUT / DELETE | `/api/pages/:pid/reaction` | anyone who can view (react / take it back) |
| GET | `/api/notifications` | your bell |
| POST | `/api/notifications/read` | mark `{ids}` or all as read |

## Notes

- Images are resized in the browser (max 1400px, JPEG) and stored inside the page JSON, so there is no separate file storage to set up.
- HTML typed by editors is sanitised before it is shown, so a shared editor cannot inject scripts.
- The masthead is styled after classic broadsheets but uses your own paper name. It does not copy any real newspaper's logo or name.
- Ideas for later: live co-editing with Socket.io, public read-only share links, more page templates.
