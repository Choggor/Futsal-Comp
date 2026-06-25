import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function resp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Verify caller is a super_admin via their JWT
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    )
    const { data: { user } } = await anonClient.auth.getUser()
    if (!user) return resp({ error: 'Unauthorized' }, 401)

    const { data: appUser } = await anonClient
      .from('app_users')
      .select('role')
      .eq('auth_user_id', user.id)
      .single()

    if (appUser?.role !== 'super_admin') return resp({ error: 'Forbidden' }, 403)

    // Use service-role client to send the invite
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { email, display_name } = await req.json()
    if (!email) return resp({ error: 'email is required' }, 400)

    // Invite the user via Supabase Auth
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { display_name },
    })
    if (inviteErr) return resp({ error: inviteErr.message }, 400)

    // Create app_users row with venue_admin role
    const { error: insertErr } = await admin.from('app_users').insert({
      auth_user_id: invited.user.id,
      display_name: display_name || email,
      role: 'sub_admin',
    })
    if (insertErr) return resp({ error: insertErr.message }, 400)

    return resp({ success: true })
  } catch (e) {
    return resp({ error: String(e) }, 500)
  }
})
