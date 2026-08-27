// server/middleware/authMiddleware.js
// Verifies the Supabase-issued JWT sent from the frontend (in the Authorization header),
// and attaches the user + their profile (role, team_id) to req.user for downstream routes.

const supabase = require('../services/supabaseClient');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization; // expected format: "Bearer <token>"

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  const token = authHeader.split(' ')[1];

  // Ask Supabase to verify this token and tell us which user it belongs to.
  const { data: userData, error: userError } = await supabase.auth.getUser(token);

  if (userError || !userData?.user) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  // Fetch this user's profile row (role + team_id) for authorization checks.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userData.user.id)
    .single();

  if (profileError || !profile) {
    return res.status(403).json({ error: 'No profile found for this user.' });
  }

  req.user = {
    id: userData.user.id,
    email: userData.user.email,
    role: profile.role,
    team_id: profile.team_id,
  };

  return next();
}

module.exports = authMiddleware;
