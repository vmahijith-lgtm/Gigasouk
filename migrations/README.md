# Applying the privacy-hardening migration in Supabase

This is a one-time, **idempotent** migration. It locks down the
`manufacturers`, `profiles`, and `designers` tables so that:

- **Bank account, IFSC and GST** never leave the manufacturer's own row.
- **Email, phone, wallet balance** of one user are never visible to others
  (the row owner reads them through the backend `/api/auth/me` endpoint,
  which uses your service-role key and therefore bypasses RLS legitimately).
- **Designer earnings** stay private to the designer.
- A handful of broken RLS policies that compared `auth.uid()` against the
  wrong column are repaired (they were silently denying everything).

The script is at `/app/migrations/safe_rls.sql`.

---

## Step-by-step

### 1. Open the Supabase SQL Editor

1. Go to <https://supabase.com/dashboard> and select your project
   (`cweizgjulmfepacmdbxe`).
2. In the left sidebar click the **SQL Editor** (the `</>` icon).
3. Click **New query**.

### 2. Paste the migration

Copy the entire contents of `/app/migrations/safe_rls.sql` from this
repo and paste it into the editor.

> Tip: in the terminal you can run
> ```bash
> cat /app/migrations/safe_rls.sql | pbcopy   # macOS
> cat /app/migrations/safe_rls.sql | xclip -selection clipboard   # Linux
> ```

### 3. Run

Click **Run** (or press `Cmd/Ctrl + Enter`). You should see
"Success. No rows returned." If you see an error, scroll up — every
statement is wrapped in `DROP IF EXISTS` so re-running is always safe.

### 4. Verify (optional but recommended)

Run this query in the same SQL editor:

```sql
-- 1. The new manufacturer self-policies should appear
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('manufacturers', 'profiles', 'designers')
ORDER BY tablename, policyname;
```

You should see `manufacturers_self_read`, `manufacturers_self_update`,
plus the existing ones.

```sql
-- 2. The sensitive columns should NOT be granted to anon/authenticated
SELECT grantee, privilege_type, column_name
FROM information_schema.role_column_grants
WHERE table_name = 'profiles'
  AND grantee IN ('anon', 'authenticated')
  AND column_name IN ('email', 'phone', 'wallet_balance');
```

This should return **0 rows** after the migration. If you still see rows,
the `REVOKE` did not take effect.

```sql
-- 3. Sanity check: the service role still sees everything
SELECT count(*) AS total_manufacturers FROM manufacturers;
```

(Run as service role from the backend; should return your real count.)

### 5. Test in the app

After applying the migration:

| Action                                | Expected result                                    |
| ------------------------------------- | -------------------------------------------------- |
| Manufacturer logs in                  | Dashboard loads with `shop_name`, jobs, payouts.   |
| Manufacturer goes to Profile tab      | Bank account / IFSC / GST visible to **them only**.|
| Designer logs in                      | Earnings + wallet visible to **them only**.        |
| Customer browses live products        | Sees designer name + product details. **No emails / phones / wallets exposed.** |
| Anonymous (logged-out) visitor        | Same as above — no leaks.                          |

### 6. Rollback

If anything goes wrong, you can roll back the column REVOKEs in seconds:

```sql
GRANT SELECT (email, phone, wallet_balance) ON profiles TO anon, authenticated;
GRANT SELECT (total_earnings) ON designers TO anon, authenticated;
DROP POLICY IF EXISTS "manufacturers_self_read"   ON manufacturers;
DROP POLICY IF EXISTS "manufacturers_self_update" ON manufacturers;
```

The fixed RLS policies (Section 4 of the migration) can stay — they're
the same logical intent as the originals, just correctly written.

---

## What changed in the app code

After running this migration, the dashboards no longer pull sensitive
columns directly from Supabase. They go through the backend instead:

- `GigaSoukManufacturerDashboard.jsx` — fetches `manufacturer` and `profile`
  rows from `GET /api/auth/me`.
- `GigaSoukDesignerDashboard.jsx` — fetches `wallet_balance`, `email`, `phone`
  from the same endpoint.

The backend (`/app/backend/routers/auth_router.py`) was updated to return
the full owner profile + extension via the service-role client.

If you ever want to roll back the code-side changes, those two files plus
`/app/backend/routers/auth_router.py::get_me` are the only places to look.
