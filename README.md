# HR Management System

A modern HRMS built with Next.js 16, Prisma, and Tailwind CSS. Features:

- Employee management
- Payroll processing
- Letter generation (offers, appointments, relieving)
- Audit logging
- Email notifications (placeholder)

## Repository

https://github.com/ibmdigitech/HR_SYSTEM

## Getting Started

```bash
git clone https://github.com/ibmdigitech/HR_SYSTEM.git
cd HR_SYSTEM/hr-system
npm install
npx prisma generate
npx prisma db push
npm run dev
```

## Project Structure

- `app/` – Next.js app router pages and API routes
- `prisma/` – Prisma schema and migrations
- `components/` – UI components (Tailwind)
- `lib/` – utilities (prisma client, validation)
- `scripts/` – seed scripts

## Development

Run the dev server:

```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

## Deployment

Deployed on Vercel. Ensure your Git email matches the Vercel account.

## Contributing

Open issues or PRs. Follow the code style (Prettier, ESLint).

## License

MIT
