/**
 * Supabase Edge Function: /functions/v1/cast-vote
 *
 * Handles vote recording + ELO updates server-side so clients
 * cannot tamper with scores directly.
 *
 * Deploy:
 *   supabase functions deploy cast-vote
 *
 * Then update vote.html to call:
 *   fetch(`${SUPABASE_URL}/functions/v1/cast-vote`, {
 *     method: 'POST',
 *     headers: {
 *       'Content-Type': 'application/json',
 *       'Authorization': `Bearer ${session.access_token}`,
 *     },
 *     body: JSON.stringify({ winnerId, loserId }),
 *   })
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const K = 32
function expectedScore(a: number, b: number) { return 1 / (1 + Math.pow(10, (b - a) / 400)) }
function newElo(player: number, opponent: number, score: 1 | 0) {
  return Math.round(player + K * (score - expectedScore(player, opponent)))
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing auth' }, 401)

    // Use the user's JWT to verify identity
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    const { winnerId, loserId } = await req.json()
    if (!winnerId || !loserId || winnerId === loserId) {
      return json({ error: 'Invalid payload' }, 400)
    }

    // Fetch both profiles
    const { data: profiles, error: fetchError } = await supabase
      .from('profiles')
      .select('id, elo_score, vote_count')
      .in('id', [winnerId, loserId])

    if (fetchError || !profiles || profiles.length !== 2) {
      return json({ error: 'Profiles not found' }, 404)
    }

    const winner = profiles.find(p => p.id === winnerId)!
    const loser  = profiles.find(p => p.id === loserId)!

    // Prevent voting for yourself
    if (winner.id === user.id || loser.id === user.id) {
      return json({ error: 'Cannot vote in a matchup involving yourself' }, 400)
    }

    const winnerNewElo = newElo(winner.elo_score, loser.elo_score, 1)
    const loserNewElo  = newElo(loser.elo_score,  winner.elo_score, 0)

    // Use service role client for writes (bypasses RLS)
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const [voteRes, winnerRes, loserRes] = await Promise.all([
      serviceClient.from('votes').insert({
        voter_id: user.id, winner_id: winnerId, loser_id: loserId,
      }),
      serviceClient.from('profiles').update({
        elo_score: winnerNewElo, vote_count: winner.vote_count + 1,
      }).eq('id', winnerId),
      serviceClient.from('profiles').update({
        elo_score: loserNewElo, vote_count: loser.vote_count + 1,
      }).eq('id', loserId),
    ])

    if (voteRes.error || winnerRes.error || loserRes.error) {
      return json({ error: 'Database update failed' }, 500)
    }

    return json({ winnerNewElo, loserNewElo, winnerDelta: winnerNewElo - winner.elo_score })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
