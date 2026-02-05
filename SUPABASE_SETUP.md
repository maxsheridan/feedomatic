# Supabase Sync Setup

This guide will help you set up Supabase to sync your favorites and archived items (or whatever views you've added) across devices.

## What You Need

- A free Supabase account
- The Feedomatic App

## Step 1: Create a Supabase Account

1. Go to [supabase.com](https://supabase.com)
2. Click "Start your project" and sign up
3. Verify your email

## Step 2: Create a New Project

1. Click "New Project"
2. Fill in:
   - **Name**: `feedomatic` (or whatever you name the app)
   - **Database Password**: Create a password.
   - **Region**: Set your region.
3. Click "Create new project" and wait for it to initialize

## Step 3: Create the Database Table

1. In your Supabase project, click **"SQL Editor"** in the left sidebar
2. Click **"New query"**
3. Paste the following SQL code:

```sql
-- Create the user_data table
CREATE TABLE user_data (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  data_type TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, data_type)
);

-- Add an index for faster queries
CREATE INDEX idx_user_data_user_id ON user_data(user_id);
CREATE INDEX idx_user_data_type ON user_data(user_id, data_type);
```

4. Click **"Run"** to execute the query
5. If everything's ok, you'll see: "Success. No rows returned"

## Step 4: Get Your API Credentials

1. In your Supabase project, click **"Settings"** (gear icon, left sidebar)
2. Click **"API"** under Project Settings
3. You'll need these two values:
   - **Project URL**: Under "Project URL" (looks like `https://xxxxxxxxxxxxx.supabase.co`)
   - **anon public key**: Under "Project API keys" → "anon public" (long string starting with `eyJ...`)

## Step 5: Configure App

1. Open app in your browser
2. Open the browser's Developer Console:
   - **Chrome/Edge**: Press `F12` or `Cmd+Option+J` (Mac) / `Ctrl+Shift+J` (Windows)
   - **Firefox**: Press `F12` or `Cmd+Option+K` (Mac) / `Ctrl+Shift+K` (Windows)
   - **Safari**: Press `Cmd+Option+C` (Mac)
3. In the console, paste this command. (Replace the placeholder values with your credentials. Your unique ID is your supabase username/email.):

```javascript
localStorage.setItem('rss_supabase_config', JSON.stringify({
  url: 'YOUR_PROJECT_URL',
  key: 'YOUR_ANON_KEY',
  userId: 'YOUR_UNIQUE_ID'
}));
```

Example:
```javascript
localStorage.setItem('rss_supabase_config', JSON.stringify({
  url: 'https://abcdefghijklmnop.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYxNjE2MTYxNiwiZXhwIjoxOTMxNzM3NjE2fQ.xxxxxxxxxxxxxxxxxxxxxxxxxx',
  userId: 'myemail@example.com'
}));
```

1. Press Enter to execute
2. **Reload the page**

## Step 6: Test the Sync

1. Add a favorite or archive an item
2. Open app on your second device (phone, tablet, etc.)
3. Repeat Step 5 on the second device using the **same credentials and userId**
4. Reload the page
5. Your favorites and archived items should now appear.

## How It Works

- When you favorite or archive an item, it's saved to both localStorage (for offline access) and Supabase (for sync)
- When you load the app, it checks Supabase first and updates localStorage with the latest data
- All devices using the same `userId` will share the same favorites and archived items

## Troubleshooting

### Sync not working?

1. Open the browser console (Step 5) and look for any red error messages
2. Check that your credentials are correct
3. Make sure you're using the **same userId** on all devices
4. Verify the table was created correctly (Step 3)

### Want to reset everything?

In the browser console, run:
```javascript
localStorage.removeItem('rss_supabase_config');
localStorage.removeItem('rss_favorites');
localStorage.removeItem('rss_read_items');
```

Then reload the page.

## Security Notes

- The `anon public` key is safe to use in client-side code
- Data is specific to your `userId` so use a unique one
- For better security, you could add Row Level Security (RLS) policies in Supabase (advanced)
- Never share your Database Password or service_role key

## Free Tier Limits

Supabase free tier includes:
- 500MB database storage
- 2GB file storage  
- Unlimited API requests
- 50,000 monthly active users