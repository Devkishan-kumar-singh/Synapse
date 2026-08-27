// server/middleware/roleMiddleware.js
// Usage: router.post('/commit', authMiddleware, requireRole('admin', 'engineer'), handler)

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden: requires one of [${allowedRoles.join(', ')}], but you are '${req.user.role}'.`,
      });
    }
    next();
  };
}

module.exports = requireRole;
