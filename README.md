# Newtonite — Operations Under Pressure

Newtonite is a team-based operations management application for creating, assigning, tracking, reviewing, and resolving work items. It focuses on reliable workflows, secure team-level access, and consistent data handling.

## Features

- **Authentication and Authorization:** JWT-based authentication, password hashing, login throttling, and role-based permissions.
- **Work Item Management:** Create, assign, claim, edit, and track incidents, customer issues, payments, compliance items, and tasks.
- **Approval Workflow:** Manage work through Open, In Progress, Awaiting Approval, Resolved, and Closed states.
- **Dashboard:** View assigned work, unassigned urgent items, and pending approvals.
- **Search and Filtering:** Filter items by status, priority, type, assignee, and team, with cursor-based pagination.
- **Activity Timeline and Comments:** Track updates and collaborate on individual work items.
- **Conflict Protection:** Detect stale edits and handle concurrent claims safely.
- **Audit Trail:** Record changes alongside their database transactions.
- **Background Jobs:** Process queued jobs with retries and failure recovery.

## Technology Stack

- **Frontend:** React, Vite, Tailwind CSS, React Router, TanStack Query, lucide-react
- **Backend:** Node.js, Express
- **Database:** PostgreSQL
- **Testing:** Vitest, Supertest
- **Infrastructure:** Docker Compose

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Docker Desktop with Docker Compose
- Git

## Getting Started

### Option 1: Run with Docker

From the project root, run:

```bash
docker compose up --build
```

The Docker setup starts the database and application services, applies database migrations, and loads demo data.

Once the services are running, access:

- **Web application:** http://localhost:5173
- **API health:** http://localhost:3000/api/v1/health
- **API readiness:** http://localhost:3000/api/v1/ready

Stop the services with:

```bash
docker compose down
```

To remove the database volume and its data as well:

```bash
docker compose down -v
```

### Option 2: Run Locally

Create your local environment file:

```powershell
Copy-Item .env.example .env
```

Install dependencies and start PostgreSQL using Docker:

```bash
npm install
docker compose up -d db
```

Run database migrations and seed demo data:

```bash
npm run db:migrate
npm run db:seed
```

Start the API, worker, and frontend in separate terminals:

```bash
npm run dev:api
npm run dev:worker
npm run dev:client
```

The frontend is available at http://localhost:5173.

## Demo Accounts

The following accounts are provided for local demonstration.

**Password for all demo accounts:** `Passw0rd!demo`

| Email | Role |
|---|---|
| `alex.admin@newtonite.test` | Admin across all teams |
| `priya.lead@newtonite.test` | Lead: Platform Operations; Member: Payments |
| `omar.lead@newtonite.test` | Lead: Customer Support |
| `chen.lead@newtonite.test` | Lead: Payments |
| `nina.lead@newtonite.test` | Lead: Compliance |
| `sam.member@newtonite.test` | Member: Platform Operations and Customer Support |
| `jo.member@newtonite.test` | Member: Customer Support |
| `rita.member@newtonite.test` | Member: Payments and Compliance |
| `tom.member@newtonite.test` | Member: Platform Operations |
| `vera.viewer@newtonite.test` | Viewer: Platform Operations and Payments |

Use these credentials only in the local demo environment.

## Testing and Verification

Run static checks:

```bash
npm run check
```

Run the server and API test suite:

```bash
npm test
```

Run frontend tests:

```bash
npm run test:client
```

Create a production frontend build:

```bash
npm run build
```

### Verified Results

- Static checks: 0 problems
- Server/API tests: 94 tests passed across 11 test files
- Frontend tests: 7 tests passed
- Production frontend build: successful

**Note:** The Docker image build has not been independently verified.

## Project Structure

```text
newtonite-ops/
├── client/                  # React frontend
├── server/                  # Express API and background worker
├── database/
│   ├── migrations/          # Database schema migrations
│   └── seeds/               # Demo data
├── tests/                   # Automated tests
├── scripts/                 # Development and verification scripts
├── .env.example             # Example environment configuration
├── .gitignore
├── docker-compose.yml       # Docker services
├── Dockerfile
├── ENGINEERING_DECISIONS.md # Technical decisions and trade-offs
├── package.json
├── package-lock.json
└── README.md
```

## Documentation

- `ENGINEERING_DECISIONS.md` — Technical decisions, trade-offs, and known limitations.

## Security Notes

- Keep `.env` private and never commit it to version control.
- Use `.env.example` to document required environment variables.
- Demo credentials are intended only for local testing.
- Configure secure secrets and production settings before deployment.

## License

No license has been specified yet.