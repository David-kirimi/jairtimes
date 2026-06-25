# Render Deployment Guide

## Pre-Deployment Checklist

✅ **Completed Setup Files:**
- `package.json` - Updated with Node 18.x requirement and scripts
- `.env.example` - Complete environment variable template
- `.gitignore` - Excludes sensitive files and node_modules
- `render.yaml` - Render-specific deployment configuration
- `Procfile` - Process definition for web dyno
- `.nvmrc` - Node version specification (18.20.3)
- `README.md` - Complete documentation with deployment steps

## What Changed

### 1. Environment Configuration
**Before**: Hardcoded values and fallbacks
**After**: All sensitive data in environment variables via `.env`

### 2. Port Configuration
**Status**: ✅ Already using `process.env.PORT || 10000`
Render will set PORT automatically; your app will use it.

### 3. Node Version Specification
**Added**: `.nvmrc` (18.20.3) and `engines` in package.json
Ensures consistent Node version across environments

### 4. Firebase Integration
**Status**: ✅ Already supports multiple credential methods:
- `FIREBASE_SERVICE_ACCOUNT_JSON` (JSON string)
- `FIREBASE_SERVICE_ACCOUNT_PATH` (file path)
- Individual vars: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

### 5. Deployment Configuration
**Added**: `render.yaml` for one-click deployment
Specifies build command, start command, and environment setup

## Deployment Steps

### Step 1: Push to GitHub

```bash
# Initialize repository if not already done
cd ~/Desktop/jairtimes
git init
git add .
git commit -m "Prepare for Render deployment"
git branch -M main

# Add remote and push
git remote add origin https://github.com/yourusername/jairtimes.git
git push -u origin main
```

### Step 2: Create Render Account & Service

1. Go to https://render.com
2. Sign up / Log in
3. Click "New +" → "Web Service"
4. Select GitHub repository (jairtimes)
5. Configure:
   - Name: `jairtimes`
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Plan: **Free**

### Step 3: Add Environment Variables

In Render Dashboard, navigate to your service → Environment

Add all variables from `.env.example`:

```
# Daraja Credentials (from Safaricom Developer Portal)
DARAJA_CONSUMER_KEY=your_key
DARAJA_CONSUMER_SECRET=your_secret
DARAJA_SHORTCODE=your_shortcode
DARAJA_PASSKEY=your_passkey
DARAJA_INITIATOR_NAME=your_initiator
DARAJA_SECURITY_CREDENTIAL=your_encrypted_credential

# Firebase (from Firebase Console → Project Settings)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQE...\n-----END PRIVATE KEY-----\n"

# Admin Credentials
ADMIN_USER=admin
ADMIN_PASS=YourSecurePasswordHere123!

# SMS Notifications (Talksasa API)
TALKSASA_API_KEY=your_api_key
TALKSASA_SENDER=JAirtimes

# Security
SESSION_SECRET=GenerateStrongRandomSecretAt-Least-32-Characters
NODE_ENV=production
HOST_URL=https://your-app.onrender.com
```

**Important**: After adding HOST_URL, copy it from your Render service URL once deployed.

### Step 4: Deploy

1. Click "Deploy" button in Render
2. Monitor build progress in Logs tab
3. Wait for "Deployed successfully" message
4. Your app is now live at `https://your-app.onrender.com`

### Step 5: Configure Daraja Webhooks

Update your Safaricom M-PESA configuration:

1. Go to Safaricom Developer Portal
2. Update C2B URLs to:
   - **Confirmation URL**: `https://your-app.onrender.com/api/mpesa/confirmation`
   - **Validation URL**: `https://your-app.onrender.com/api/mpesa/validation`

### Step 6: Test Deployment

1. Visit `https://your-app.onrender.com` → Dashboard
2. Check Socket.io connection (Gateway Status badge)
3. Visit `https://your-app.onrender.com/admin.html` → Admin Panel
4. Verify Daraja config is accessible

## Render Free Tier Specifics

| Aspect | Details |
|--------|---------|
| **Memory** | 512 MB (sufficient for this app) |
| **CPU** | Shared vCPU |
| **Storage** | `/tmp` only (ephemeral - recreated per deploy) |
| **Request Timeout** | 30 seconds ✅ (your webhooks are quick) |
| **Coldstart** | ~30 seconds after 15 min inactivity |
| **Sleep** | Instance spins down after 15 min idle |
| **Bandwidth** | Generous (no metering) |
| **Cost** | $0/month ✅ |

## Data Persistence Notes

### Firebase (Recommended - Primary Storage)
✅ All customer data, logs, and transactions stored in Firestore
✅ Survives deployments, restarts, and crashes
✅ Accessible from admin panel

### JSON Files (`/data` directory)
⚠️ Ephemeral storage - lost after deployment
📝 Automatically recreated on startup (empty)
💡 Serves as fallback if Firebase unavailable

**Recommendation**: Keep Firebase as primary. JSON fallback useful for dev/testing.

## Common Issues & Solutions

### Issue: "Address already in use"
**Solution**: Render manages ports automatically. This only occurs locally.

### Issue: Socket.io showing "Offline"
**Status**: Normal on cold-start (30 sec spin-up)
**Solution**: Refresh page after 30 seconds

### Issue: Firebase errors in logs
**Check**:
1. All Firebase vars are set correctly
2. Private key has escaped newlines: `\n` (not literal line breaks)
3. Firebase Firestore is created in console
4. Service account has Firestore permissions

### Issue: Daraja API 401 errors
**Check**:
1. Consumer key and secret are correct
2. Test credentials locally first (`npm start`)
3. Shortcode is registered for C2B
4. Webhook URLs in Safaricom portal match Render URL

### Issue: Admin login fails
**Solution**: 
1. Check `ADMIN_USER` and `ADMIN_PASS` in env vars
2. Default: `admin` / `Password123`
3. Change via admin panel after first login

## Monitoring & Debugging

### View Logs
1. Render Dashboard → Your Service
2. Click "Logs" tab
3. Real-time log streaming (all console output)

### Redeploy
1. Push changes to GitHub
2. Render auto-deploys on push (if manual deploy not selected)
3. Or click "Manual Deploy" in Render dashboard

### Check Status
- Green dot = Running ✅
- Yellow dot = Building/Deploying
- Red dot = Error (check logs)

## Upgrading from Free Tier

If you need:
- **Persistent storage** → Render Standard/Pro tier
- **Always-on instance** → Paid tier (no cold-starts)
- **Custom domain** → Add in Render settings
- **SSL certificate** → Auto-included with .onrender.com

Free tier is perfect for MVP testing and development! 🚀

## Next Steps

1. ✅ Deploy to Render
2. ⚙️ Configure Daraja credentials in admin panel
3. 📊 Monitor live dashboard
4. 💳 Set up partner payout schedule
5. 📱 Test C2B webhook integration

---

Need help? Check Render's [documentation](https://render.com/docs) or review server logs for specific errors.
