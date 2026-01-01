# Fix Database Sync

The automated command failed to confirm the reset. Please run this manually:

1.  **Run in Terminal**:
    ```bash
    npx prisma migrate dev --name init
    ```
2.  **Confirm Reset**:
    *   It will ask: `We need to reset the "public" schema... Do you want to continue?`
    *   Type **`y`** and press Enter.

3.  **Deploy**:
    *   Once the `prisma/migrations` folder is created:
    *   `git add .`
    *   `git commit -m "fix: init migrations"`
    *   `git push`

Railway will then pick up the migrations and deploy successfully.
