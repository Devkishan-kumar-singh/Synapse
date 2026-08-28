# Synapse

Synapse is an email-OTP prompt version-control and A/B testing workspace. Anyone can create an account; every new user receives an isolated private workspace and becomes its first Admin.

The workspace includes a branch-aware prompt editor, immutable commit history, rollback controls, and a real-time team chat drawer with workspace and project conversation scopes.

## Access model

| Role | Access |
|---|---|
| Admin | Team invitations, roles, prompts, versions, tests, and audit activity |
| Prompt Engineer | Create prompt projects, branches, commits, and rollbacks |
| Tester | View projects, run A/B tests, and record verdicts |
| Viewer | Read-only project access |

There is no password registration form. A verified new user creates a workspace after entering the email OTP. Users cannot enter somebody else's workspace or select a role there. A workspace Admin invites additional members and assigns their roles.

## Stack

- Node.js 20+ and Express
- Supabase Auth and Postgres
- Plain HTML, CSS, and JavaScript frontend
- OpenAI and Anthropic provider adapters

## Fresh setup

1. Create a Supabase project.
2. In Supabase Authentication > Providers > Email, enable email authentication and allow new-user sign-ups.
3. In Authentication > Email Templates > Magic Link, use `{{ .Token }}` in the email body instead of `{{ .ConfirmationURL }}`. This makes Supabase send a six-digit OTP rather than a magic link.
4. Add `http://localhost:5000/login.html` to the allowed redirect URLs.
5. Open the Supabase SQL Editor and run `schema.sql` once in a new database.
6. Copy `.env.example` to `.env` and enter the project URL, anon key, and service-role key.
7. Add at least one LLM API key if you want to execute A/B tests.
8. Install and check the project:

```bash
npm install
npm run check
```

## Create the first administrator

The first administrator is created from the server, never through the public website:

```bash
npm run bootstrap-admin -- admin@company.com StrongPassword123 "Company Team" "Admin Name"
```

After that administrator logs in with an email OTP, they can invite Prompt Engineers, Testers, Viewers, and other Admins from the dashboard.

## Run locally

```bash
npm start
```

Open `http://localhost:5000`. Every visitor sees the main page first. Invited team members can use **Team Login** to access the workspace.

## Upgrade an existing database

If the original Synapse schema is already running, do not run `schema.sql` again. Run each file in `migrations/` once, in filename order. For the collaboration release, run:

```text
migrations/002_collaboration.sql
```

This adds team/project chat, its security policy, indexes, and Supabase Realtime publication. Existing users, teams, prompts, and roles are preserved.

## Deploy on Render

1. Push the project to a private GitHub repository. Never commit `.env`.
2. In Render select **New > Blueprint** and connect the repository. Render reads `render.yaml`.
3. Enter the requested Supabase and LLM environment values.
4. After Render assigns a URL such as `https://synapse-app.onrender.com`, set both `APP_ORIGIN` and `INVITE_REDIRECT_URL` to that origin and login page respectively.
5. In Supabase Authentication > URL Configuration, set the Site URL to the Render origin and add the production login URL to Redirect URLs.
6. Redeploy and confirm `/api/health` returns a successful response.

## Required environment values

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
PORT=5000
APP_ORIGIN=http://localhost:5000
INVITE_REDIRECT_URL=http://localhost:5000/login.html
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

The service-role and LLM keys must remain server-side. Never place them in `public/` or commit `.env`.

## Security included

- Invitation-only accounts and server-assigned roles
- JWT verification for every protected API request
- Team ownership checks for prompts, branches, commits, rollbacks, and tests
- Role checks on both API actions and dashboard controls
- Row Level Security for browser-side reads
- Security headers, API rate limiting, restricted CORS, and request-size limits
- Safe DOM rendering for project content
- Audit records for team invitations and version-control activity
- Team-scoped real-time chat with safe text rendering
- Project ownership checks for project-specific conversations

## Validation

`npm run check` validates every JavaScript file. `npm audit --omit=dev` should also be run before deployment. Production deployment should provide HTTPS, managed environment secrets, database backups, logging, and an application-specific domain in `APP_ORIGIN` and `INVITE_REDIRECT_URL`.
