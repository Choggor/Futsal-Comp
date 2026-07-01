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

    const { data: caller } = await anonClient
      .from('app_users')
      .select('role')
      .eq('auth_user_id', user.id)
      .single()

    if (caller?.role !== 'super_admin') return resp({ error: 'Forbidden' }, 403)

    // Use service-role client for privileged operations
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const body = await req.json()

    // Delete user
    if (body.action === 'delete') {
      const { app_user_id } = body
      if (!app_user_id) return resp({ error: 'app_user_id is required' }, 400)

      const { data: target } = await admin.from('app_users').select('auth_user_id').eq('id', app_user_id).single()
      if (!target) return resp({ error: 'User not found' }, 404)

      await admin.from('app_users').delete().eq('id', app_user_id)

      const { error: authErr } = await admin.auth.admin.deleteUser(target.auth_user_id)
      if (authErr) return resp({ error: authErr.message }, 400)

      return resp({ success: true })
    }

    // Invite user
    const { email, display_name, role } = body
    if (!email) return resp({ error: 'email is required' }, 400)

    const assignedRole = role === 'super_admin' ? 'super_admin' : 'sub_admin'

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { display_name },
    })
    if (inviteErr) return resp({ error: inviteErr.message }, 400)

    const { error: insertErr } = await admin.from('app_users').insert({
      auth_user_id: invited.user.id,
      display_name: display_name || email,
      role: assignedRole,
    })
    if (insertErr) {
      await admin.auth.admin.deleteUser(invited.user.id)
      return resp({ error: insertErr.message }, 400)
    }

    return resp({ success: true })
  } catch (e) {
    return resp({ error: String(e) }, 500)
  }
})
