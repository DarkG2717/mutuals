#!/usr/bin/env python3
"""
MUTUALS — staging check.

No cloud staging project is linked to this repo yet, so this spins up a real
Postgres (bundled binary, no docker, no root), applies every migration in order,
then exercises the messaging schema as the `authenticated` role so RLS actually
applies.

Requires: pip install pgserver "psycopg[binary]"

    python3 scripts/db-staging-check.py

Exit code 0 = every check passed.
"""

import pathlib
import shutil
import sys
import tempfile
import uuid

import pgserver
import psycopg

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "supabase" / "migrations"
PGDATA = pathlib.Path(tempfile.mkdtemp(prefix="pg-mutuals-"))

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("  PASS  " if ok else "  FAIL  ") + name + (("  — " + str(detail)) if detail and not ok else ""))


def main():
    server = pgserver.get_server(PGDATA)
    conn = psycopg.connect(server.get_uri(), autocommit=True)

    def sql(text):
        return conn.execute(text)

    def scalar(text):
        row = conn.execute(text).fetchone()
        return row[0] if row else None

    def as_user(uid=None):
        conn.execute("reset role")
        conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (uid or "",))

    def as_super():
        conn.execute("reset role")
        conn.execute("select set_config('request.jwt.claim.sub', '', false)")

    # ------------------------------------------------------------------
    # bootstrap what Supabase provides and plain Postgres doesn't
    # ------------------------------------------------------------------
    sql("""
      create schema if not exists auth;

      create table if not exists auth.users (
        id uuid primary key default gen_random_uuid(),
        email text unique
      );

      create or replace function auth.uid()
      returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;

      do $$ begin
        if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
          create publication supabase_realtime;
        end if;
      end $$;

      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then
          create role authenticated nologin;
        end if;
        if not exists (select 1 from pg_roles where rolname = 'anon') then
          create role anon nologin;
        end if;
      end $$;
    """)

    # ------------------------------------------------------------------
    # migrations, in filename order
    # ------------------------------------------------------------------
    print("\n-- migrations --")

    # --combined <file>: prove the paste-and-run script is equivalent to the
    # migrations it was generated from, instead of applying those files twice.
    combined = None
    if "--combined" in sys.argv:
        combined = pathlib.Path(sys.argv[sys.argv.index("--combined") + 1])

    for path in sorted(MIGRATIONS.glob("*.sql")):
        if combined and path.name.startswith("2026112023"):
            continue
        body = path.read_text()
        body = body.replace("create extension if not exists pgcrypto;",
                            "-- pgcrypto omitted: contrib not shipped; gen_random_uuid() is core")
        try:
            conn.execute(body)
            check(path.name, True)
        except Exception as exc:
            check(path.name, False, str(exc).strip().splitlines()[0])

    if combined:
        try:
            conn.execute(combined.read_text())
            check("combined script: " + combined.name, True)
        except Exception as exc:
            check("combined script: " + combined.name, False, str(exc).strip().splitlines()[0])

    # Supabase grants these via default privileges
    sql("""
      grant usage on schema public to authenticated, anon;
      grant all on all tables in schema public to authenticated, anon;
      grant all on all sequences in schema public to authenticated, anon;
      grant execute on all functions in schema public to authenticated, anon;
    """)

    # ------------------------------------------------------------------
    # fixtures
    # ------------------------------------------------------------------
    A, B, C = (str(uuid.uuid4()) for _ in range(3))

    sql(f"""
      insert into auth.users (id, email) values
        ('{A}', 'a@test.dev'), ('{B}', 'b@test.dev'), ('{C}', 'c@test.dev');

      insert into public.profiles (id, full_name, birth_year, hall, age, onboarding_completed)
      values
        ('{A}', 'Ada', 2005, 'Moremi', 21, true),
        ('{B}', 'Tobi', 2004, 'Zik', 22, true),
        ('{C}', 'Chika', 2006, 'Esther', 20, true);

      insert into public.matches (user_one, user_two)
      values (least('{A}'::uuid, '{B}'::uuid), greatest('{A}'::uuid, '{B}'::uuid)),
             (least('{B}'::uuid, '{C}'::uuid), greatest('{B}'::uuid, '{C}'::uuid));
    """)

    match_ab = scalar(f"""select id from public.matches
      where user_one = least('{A}'::uuid,'{B}'::uuid) and user_two = greatest('{A}'::uuid,'{B}'::uuid)""")
    match_bc = scalar(f"""select id from public.matches
      where user_one = least('{B}'::uuid,'{C}'::uuid) and user_two = greatest('{B}'::uuid,'{C}'::uuid)""")

    print("\n-- messaging behaviour (as authenticated) --")

    # 1. a thread has nothing in it until someone speaks
    as_user(A)
    sql("set role authenticated")
    count = scalar(f"select count(*) from public.messages where match_id = '{match_ab}'")
    check("empty thread has no messages", count == 0, f"count={count}")

    # 2. participant can send
    try:
        sql(f"""insert into public.messages (match_id, sender_id, body)
                values ('{match_ab}', '{A}', 'hey')""")
        check("participant can send", True)
    except Exception as exc:
        check("participant can send", False, str(exc).strip().splitlines()[0])

    # 3. cannot forge the sender
    try:
        sql(f"""insert into public.messages (match_id, sender_id, body)
                values ('{match_ab}', '{B}', 'not me')""")
        check("cannot forge sender_id", False, "insert unexpectedly succeeded")
    except psycopg.Error:
        check("cannot forge sender_id", True)

    # 4. cannot write into a match you are not part of
    try:
        sql(f"""insert into public.messages (match_id, sender_id, body)
                values ('{match_bc}', '{A}', 'intruding')""")
        check("cannot write into a match you are not in", False, "insert unexpectedly succeeded")
    except psycopg.Error:
        check("cannot write into a match you are not in", True)

    # 5. cannot read another pair's messages
    as_user(A)
    sql("set role authenticated")
    count = scalar(f"select count(*) from public.messages where match_id = '{match_bc}'")
    check("cannot read other pairs' messages", count == 0, f"count={count}")

    # 6. unread counts
    as_user(B)
    sql("set role authenticated")
    threads = conn.execute("select match_id, unread from public.get_my_threads()").fetchall()
    check("only threads with messages are listed", len(threads) == 1, f"threads={len(threads)}")
    check("B sees one unread", threads and threads[0][1] == 1, str(threads))

    # 7. read receipt clears unread
    try:
        sql(f"""insert into public.match_reads (match_id, user_id, last_read_seq)
                select '{match_ab}', '{B}', coalesce(max(seq),0)
                from public.messages where match_id = '{match_ab}'""")
        unread = conn.execute("select unread from public.get_my_threads()").fetchone()[0]
        check("unread clears after read", unread == 0, f"unread={unread}")
    except Exception as exc:
        check("unread clears after read", False, str(exc).strip().splitlines()[0])

    # 8. no read state for a thread with no messages
    as_user(A)
    sql("set role authenticated")
    try:
        sql(f"insert into public.match_reads (match_id, user_id) values ('{match_bc}', '{A}')")
        check("no read state for an empty thread", False, "insert unexpectedly succeeded")
    except psycopg.Error:
        check("no read state for an empty thread", True)

    # 9. blocking cuts both directions
    as_user(B)
    sql("set role authenticated")
    sql(f"insert into public.blocks (blocker_id, blocked_id) values ('{B}', '{A}')")

    as_user(A)
    sql("set role authenticated")
    try:
        sql(f"""insert into public.messages (match_id, sender_id, body)
                values ('{match_ab}', '{A}', 'still here?')""")
        check("blocked user cannot send", False, "insert unexpectedly succeeded")
    except psycopg.Error:
        check("blocked user cannot send", True)

    count = scalar(f"select count(*) from public.messages where match_id = '{match_ab}'")
    check("blocked user cannot read", count == 0, f"count={count}")

    # 10. trigger holds even with RLS bypassed (service-role equivalent)
    as_super()
    try:
        sql(f"""insert into public.messages (match_id, sender_id, body)
                values ('{match_bc}', '{A}', 'bypass attempt')""")
        check("trigger blocks non-participant with RLS bypassed", False, "insert unexpectedly succeeded")
    except psycopg.Error:
        check("trigger blocks non-participant with RLS bypassed", True)

    # ------------------------------------------------------------------
    print("\n-- profile cleanup --")
    before = scalar(f"select updated_at from public.profiles where id = '{A}'")
    sql(f"update public.profiles set bio = 'hello' where id = '{A}'")
    after = scalar(f"select updated_at from public.profiles where id = '{A}'")
    check("updated_at moves on update", before != after, f"{before} / {after}")

    derived = scalar(f"select birth_year from public.profiles where id = '{C}'")
    expected = scalar("select extract(year from now())::int - 20")
    check("birth_year derived from age", derived == expected, f"{derived} vs {expected}")

    # ------------------------------------------------------------------
    failed = [name for name, ok in results if not ok]
    print("\n%d checks, %d failed" % (len(results), len(failed)))
    if failed:
        print("failed: " + ", ".join(failed))

    conn.close()
    server.cleanup()
    shutil.rmtree(PGDATA, ignore_errors=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
