# JAirtimes - M-PESA Daraja USSD Gateway

A complete M-PESA routing engine backend and web dashboard for airtime distribution with real-time monitoring, admin configuration, and partner commission management.

## Features

- **Daraja Integration**: OAuth token generation, C2B webhooks, STK Push, transaction status queries, account balance checks
- **Real-time Dashboard**: Socket.io live metrics, gateway status monitoring, manual STK dispatch
- **Admin Panel**: API configuration management (Daraja, Talksasa, Firebase), partner payout processing
- **Commission System**: 10% commission tracking from bundle sales, weekly payout scheduling
- **Firebase Persistence**: Firestore for customers, logs, and transaction history
- **Theme Support**: Dark/Light mode toggle with localStorage persistence
- **Responsive UI**: Mobile-friendly cards with hover effects

## Technology Stack

- **Backend**: Node.js + Express + Socket.io
- **Frontend**: HTML5 + CSS3 + Vanilla JavaScript
- **Database**: Firebase Firestore (with JSON fallback)
- **Authentication**: express-session (admin)
- **APIs**: Daraja M-PESA, Talksasa SMS

## Local Development

### Prerequisites
- Node.js 18+
- npm or yarn
- Firebase project (optional, works without for testing)

### Installation

```bash
# Clone repository
git clone <your-repo-url>
cd jairtimes

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Add your credentials to .env
# See .env.example for required variables

# Start development server
npm start
```

The app will run on `http://localhost:10000` (or PORT specified in .env)

## Deployment on Render

### Step 1: Prepare Repository

1. Initialize git and push to GitHub/GitLab
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

2. Ensure `.env` is **NOT** committed:
```bash
# .env is already in .gitignore
```

### Step 2: Create Render Service

1. Go to [render.com](https://render.com) and sign up
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Name**: `jairtimes` (or your preferred name)
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: Free tier

### Step 3: Add Environment Variables

In Render dashboard, add all variables from `.env.example`:

**Critical Variables:**
```
DARAJA_CONSUMER_KEY
DARAJA_CONSUMER_SECRET
DARAJA_SHORTCODE
DARAJA_PASSKEY
DARAJA_INITIATOR_NAME
DARAJA_SECURITY_CREDENTIAL
```

**Firebase Variables:**
```
FIREBASE_PROJECT_ID
FIREBASE_DATABASE_URL
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

**Admin & Security:**
```
ADMIN_USER
ADMIN_PASS
SESSION_SECRET
HOST_URL=https://your-app.onrender.com
NODE_ENV=production
```

**SMS (Optional):**
```
TALKSASA_API_KEY
TALKSASA_SENDER
```

### Step 4: Deploy

Render will automatically:
1. Build: Run `npm install`
2. Start: Run `node server.js`
3. Assign a unique URL (e.g., `https://jairtimes-xxxxx.onrender.com`)

### Step 5: Test

1. Visit your deployed URL
2. Dashboard should load and connect via Socket.io
3. Admin panel: Navigate to `/admin.html`
4. Configure Daraja credentials in admin panel

## Render Free Tier Specifications

| Resource | Limit |
|----------|-------|
| Memory | 512 MB |
| vCPU | Shared |
| Request Timeout | 30 seconds |
| Sleep Mode | 15 minutes inactivity (coldstart on next request) |
| Storage | /tmp only (ephemeral) |
| Bandwidth | Generous |

**Note**: Free tier instances spin down after 15 minutes of inactivity and take ~30 seconds to restart.

## Important Considerations

### File Storage
The `/data` directory stores JSON backups. Since Render's free tier has ephemeral storage:
- **Recommended**: Use Firebase Firestore as primary storage (already implemented)
- **Fallback**: JSON files are recreated on each deployment
- **Better Alternative**: Upgrade to Render's standard tier for persistent storage

### WebSocket Connections
Socket.io works perfectly on Render ✅

### Webhooks
Ensure your Daraja C2B URLs point to your Render deployment:
```
https://your-app.onrender.com/api/mpesa/confirmation
https://your-app.onrender.com/api/mpesa/validation
```

### Monitoring
Use Render's built-in logs:
1. Dashboard → Your Service → Logs tab
2. All console.log() output appears here

## API Endpoints

### Public
- `POST /api/mpesa/confirmation` - C2B confirmation webhook
- `POST /api/mpesa/validation` - C2B validation webhook
- `POST /api/mpesa/stk-push` - Manual STK push trigger
- `POST /api/mpesa/register-urls` - Register C2B URLs
- `GET /` - Dashboard UI
- `GET /admin.html` - Admin panel

### Admin (require session)
- `POST /api/admin/login` - Authenticate admin
- `GET /api/admin/config` - Fetch configuration
- `POST /api/admin/config/daraja` - Update Daraja settings
- `POST /api/admin/config/talksasa` - Update SMS settings
- `POST /api/admin/config/firebase` - Update Firebase settings
- `POST /api/admin/credentials` - Update admin credentials
- `GET /api/admin/partners` - Get partner commission data
- `POST /api/admin/payout` - Process partner payout

## Environment Variables Reference

See `.env.example` for complete list and descriptions.

## Troubleshooting

### App keeps restarting
- Check Render logs for errors
- Verify all required env vars are set
- Check for Node memory issues (512 MB limit)

### Socket.io disconnecting
- Normal on cold-starts (instance spins down after 15 min)
- Refresh browser page to reconnect
- Consider upgrading for persistent instances

### Firebase errors
- Verify `FIREBASE_SERVICE_ACCOUNT_JSON` or individual credentials are set
- Check private key has proper newlines: `\n` → actual line breaks
- Ensure Firestore database is created in Firebase console

### Daraja API failures
- Verify consumer key/secret are correct
- Confirm shortcode is registered for C2B
- Check HOST_URL matches registered callback URLs

## Support & Issues

For issues:
1. Check Render logs (often shows the root cause)
2. Verify all env vars match your Daraja/Firebase settings
3. Test locally first with `npm start`

## License

MIT
