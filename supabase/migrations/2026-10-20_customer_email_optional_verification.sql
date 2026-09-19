-- Customers are created without an emailed code; confirming the email later is optional.
-- Relaxes ONE constraint on OUR OWN recent table (ringo_customers.email_verified_at was
-- "not null default now()", because until now a row only existed after a code was confirmed).
--
--   * NULL  = the customer typed this email but has not confirmed it (yet)
--   * a date = they confirmed it by entering the code we emailed
--
-- Existing rows keep their value (they were all created through the code flow, so they are
-- all confirmed). No data is changed, no other column/table/policy/index is touched.
-- Dropping the default matters: without it, every new row would silently be stamped as
-- "confirmed" and the flag would mean nothing.

alter table public.ringo_customers alter column email_verified_at drop not null;
alter table public.ringo_customers alter column email_verified_at drop default;
