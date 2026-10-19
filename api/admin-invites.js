import { db, auth } from './_firebaseAdmin.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-Compatible, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(token);
    const email = decodedToken.email;

    const allowedAdmins = [
      'rachata.le@gmail.com',
      '06554@tupp.ac.th',
      '06546@tupp.ac.th',
      'thanawinnoble07@gmail.com'
    ];

    if (!allowedAdmins.includes(email)) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    if (req.method === 'POST') {
      const { targetEmail } = req.body;
      if (!targetEmail) {
        return res.status(400).json({ error: 'Target email is required' });
      }

      await db.collection('councilMembers').doc(decodedToken.uid).set({
        email: email,
        isAdmin: true,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      return res.status(200).json({ success: true, message: 'Admin auto-provisioned successfully' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
