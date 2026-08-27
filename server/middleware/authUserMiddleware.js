const supabase = require('../services/supabaseClient');

async function authUserMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required.' });
  const { data, error } = await supabase.auth.getUser(header.slice(7));
  if (error || !data.user) return res.status(401).json({ error: 'Invalid or expired session.' });
  req.authUser = data.user;
  return next();
}

module.exports = authUserMiddleware;
