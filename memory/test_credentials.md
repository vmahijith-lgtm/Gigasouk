# GigaSouk — Test Credentials

> Auth: Supabase (project `cweizgjulmfepacmdbxe.supabase.co`).
> Email confirmation IS enabled on this project, so the test users below were
> created via the Supabase Admin API with `email_confirm: true` so they can
> sign in immediately without needing a real inbox.

## Pre-seeded users

| Role          | Email                              | Password    | Lands on        |
| ------------- | ---------------------------------- | ----------- | --------------- |
| Customer      | `e2ecustomer1777585785@gmail.com`  | `Test12345!` | `/`             |
| Designer      | `e2edesigner1777585743@gmail.com`  | `Test12345!` | `/designer`     |
| Manufacturer  | `e2emfr1777586046@gmail.com`       | `Test12345!` | `/manufacturer` |

## Sign-up flow

Real end-user signups go through Supabase email confirmation:
1. User submits the form on `/auth/signup` with role + name + email + password.
2. The pending profile payload is saved to `sessionStorage`.
3. Supabase sends a verification email with a link to `/auth/callback`.
4. After clicking the link, the browser exchanges the code, lands on
   `/auth/callback/complete`, and POSTs the saved payload to
   `/api/auth/create-profile` (backend, service-role).
5. The user is then redirected to their role dashboard.

## Backend / auth endpoints (mounted under `/api/auth`)

| Method | Path                       | Purpose                                              |
| ------ | -------------------------- | ---------------------------------------------------- |
| POST   | `/api/auth/create-profile` | Create profile row + role-specific extension row.    |
| GET    | `/api/auth/me`             | Return current profile + manufacturer/designer ID.   |

Both require `Authorization: Bearer <supabase-access-token>`.
