#!/usr/bin/env bash
set -u
BASE="https://hvyfzgguudvqwtybsvfv.supabase.co/rest/v1"
KEY=$(sed -n 's/.*\(sb_publishable_[A-Za-z0-9_-]\{1,\}\).*/\1/p' /home/kester/.openclaw/workspace/agents/forge/work/mutuals/assets/js/supabase.js | head -1)

probe() {
  local label="$1" path="$2" method="${3:-GET}" body="${4:-}"
  local out code
  if [ "$method" = "POST" ]; then
    code=$(curl -s -o /tmp/probe_out.json -w "%{http_code}" -X POST \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
      -H "Prefer: return=minimal" -d "${body:-{\}}" "$BASE/$path")
  else
    code=$(curl -s -o /tmp/probe_out.json -w "%{http_code}" \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "$BASE/$path")
  fi
  out=$(head -c 220 /tmp/probe_out.json)
  case "$code" in
    200|201|204) printf "OK   %-52s %s\n" "$label" "$out" ;;
    *)           printf "FAIL %-52s [%s] %s\n" "$label" "$code" "$out" ;;
  esac
}

echo "== discover.html selects =="
probe "profiles: discover columns" "profiles?select=id,full_name,nickname,hall,department,level,avatar_url,onboarding_completed&limit=0"
probe "interest_stats: idf, interests(name)" "interest_stats?select=idf,interests(name)&limit=0"
probe "swipes: swiped_id, decision" "swipes?select=swiped_id,decision&limit=0"
probe "blocks: blocker_id, blocked_id" "blocks?select=blocker_id,blocked_id&limit=0"
probe "user_interests: interest_id, interests(name)" "user_interests?select=interest_id,interests(name)&limit=0"
probe "matches: id, user_one, user_two" "matches?select=id,user_one,user_two&limit=0"
echo
echo "== auth.js upsert payload columns =="
probe "profiles: full onboarding set" "profiles?select=id,full_name,nickname,age,birth_year,gender,hall,faculty,department,level,bio,avatar_url&limit=0"
echo
echo "== messaging / inbox =="
probe "messages: match_id, sender_id, body, seq" "messages?select=match_id,sender_id,body,seq,created_at&limit=0"
probe "match_reads: last_read_seq" "match_reads?select=match_id,user_id,last_read_seq,last_read_at&limit=0"
probe "reports: message_id" "reports?select=id,message_id,reason&limit=0"
echo
echo "== rpcs =="
probe "rpc get_interest_pool" "rpc/get_interest_pool" POST
probe "rpc get_my_threads" "rpc/get_my_threads" POST
probe "rpc refresh_interest_stats" "rpc/refresh_interest_stats" POST
probe "rpc create_match_on_mutual_like" "rpc/create_match_on_mutual_like" POST '{"p_swiper":"00000000-0000-0000-0000-000000000000","p_swiped":"00000000-0000-0000-0000-000000000000"}'
