# Migration FAQ

**Q: Do I have to create the migration file manually?**
**A: NO.**

The command `npx prisma migrate dev` analyzes your `schema.prisma` and your actual database, calculates the difference, and **automatically writes** the `.sql` file into `prisma/migrations`.

## Why is it failing?
Because your database *already has tables* but your project *has no migration history* (the folder is empty). Prisma doesn't know if the existing tables match the schema perfectly.

## The Fix
You must allow Prisma to **RESET** (wipe) the local database once to establish a clean baseline.

1. Run `npx prisma migrate dev --name init`
2. It asks: "We need to reset the public schema... All data will be lost."
3. **Type `y` and Enter.**

This will:
1. Drop current tables.
2. Create the `migration.sql` file.
3. Apply the migration (re-create tables).
