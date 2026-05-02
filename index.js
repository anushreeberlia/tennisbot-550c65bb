const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
const { Expo } = require('expo-server-sdk');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || '/data/data.json';

app.use(cors());
app.use(express.json());

// Initialize Expo SDK
const expo = new Expo();

// In-memory storage for push tokens and court data
let pushTokens = [];
let courtData = {
  lastCheck: null,
  availableCourts: [],
  logs: []
};

// Load data on startup
async function loadData() {
  try {
    const data = await fs.readFile(DB_PATH, 'utf8');
    const parsed = JSON.parse(data);
    pushTokens = parsed.pushTokens || [];
    courtData = parsed.courtData || courtData;
    console.log('Data loaded from persistent storage');
  } catch (error) {
    console.log('No existing data found, starting fresh');
  }
}

// Save data to persistent storage
async function saveData() {
  try {
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    await fs.writeFile(DB_PATH, JSON.stringify({ pushTokens, courtData }, null, 2));
  } catch (error) {
    console.error('Failed to save data:', error);
  }
}

// Logging function
function log(message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  console.log(logEntry);
  
  courtData.logs.unshift(logEntry);
  if (courtData.logs.length > 100) {
    courtData.logs = courtData.logs.slice(0, 100);
  }
  
  saveData();
}

// Get upcoming Fridays
function getUpcomingFridays() {
  const fridays = [];
  const today = new Date();
  
  for (let i = 0; i < 8; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    
    if (date.getDay() === 5) { // Friday is day 5
      fridays.push(date.toISOString().split('T')[0]);
    }
  }
  
  return fridays;
}

// Scrape court availability
async function scrapeCourtAvailability() {
  try {
    log('Starting court availability check...');
    
    const fridays = getUpcomingFridays();
    log(`Checking availability for Fridays: ${fridays.join(', ')}`);
    
    const availableCourts = [];
    
    for (const friday of fridays) {
      try {
        // Simulate API call to rec.us (in real implementation, you'd need to reverse engineer their API)
        const url = `https://rec.us/joedimaggio`;
        log(`Fetching data for ${friday} from ${url}`);
        
        const response = await axios.get(url, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        // Parse the HTML to find court availability
        const $ = cheerio.load(response.data);
        
        // This is a simplified scraper - in practice you'd need to analyze the site structure
        // For demo purposes, we'll simulate finding available courts
        const mockAvailability = Math.random() > 0.7; // 30% chance of availability
        
        if (mockAvailability) {
          const courtInfo = {
            date: friday,
            court: 'Tennis Court 1',
            time: '2:00 PM - 3:00 PM',
            found: new Date().toISOString()
          };
          availableCourts.push(courtInfo);
          log(`Found available court: ${JSON.stringify(courtInfo)}`);
        } else {
          log(`No courts available for ${friday}`);
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        log(`Error checking ${friday}: ${error.message}`);
      }
    }
    
    // Update court data
    const previousCount = courtData.availableCourts.length;
    courtData.availableCourts = availableCourts;
    courtData.lastCheck = new Date().toISOString();
    
    // Send notifications if new courts found
    if (availableCourts.length > previousCount) {
      const newCourts = availableCourts.slice(previousCount);
      for (const court of newCourts) {
        await sendPushNotification(
          'Court Available! 🎾',
          `${court.court} on ${court.date} at ${court.time}`
        );
      }
    }
    
    log(`Court check completed. Found ${availableCourts.length} available courts.`);
    await saveData();
    
  } catch (error) {
    log(`Scraping error: ${error.message}`);
  }
}

// Send push notification
async function sendPushNotification(title, body) {
  if (pushTokens.length === 0) {
    log('No push tokens registered, skipping notification');
    return;
  }
  
  const messages = [];
  
  for (const pushToken of pushTokens) {
    if (!Expo.isExpoPushToken(pushToken)) {
      log(`Invalid push token: ${pushToken}`);
      continue;
    }
    
    messages.push({
      to: pushToken,
      sound: 'default',
      title,
      body,
      data: { type: 'court_available' }
    });
  }
  
  if (messages.length === 0) {
    log('No valid push tokens found');
    return;
  }
  
  try {
    const chunks = expo.chunkPushNotifications(messages);
    
    for (const chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      log(`Sent ${chunk.length} push notifications`);
    }
  } catch (error) {
    log(`Push notification error: ${error.message}`);
  }
}

// API Routes
app.get('/', (req, res) => {
  console.log(`${req.method} ${req.url} - 200`);
  res.json({ 
    status: 'ok', 
    service: 'Court Monitor API',
    lastCheck: courtData.lastCheck,
    availableCourts: courtData.availableCourts.length
  });
});

app.post('/register-token', (req, res) => {
  console.log(`${req.method} ${req.url} - 200`);
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }
  
  if (!pushTokens.includes(token)) {
    pushTokens.push(token);
    saveData();
    log(`New push token registered: ${token.substring(0, 20)}...`);
  }
  
  res.json({ success: true });
});

app.get('/courts', (req, res) => {
  console.log(`${req.method} ${req.url} - 200`);
  res.json({
    lastCheck: courtData.lastCheck,
    availableCourts: courtData.availableCourts
  });
});

app.get('/logs', (req, res) => {
  console.log(`${req.method} ${req.url} - 200`);
  res.json({ logs: courtData.logs });
});

app.post('/test-notification', async (req, res) => {
  console.log(`${req.method} ${req.url} - 200`);
  
  await sendPushNotification(
    'Test Notification 🧪',
    'Your court monitoring app is working!'
  );
  
  res.json({ success: true, message: 'Test notification sent' });
});

app.post('/check-now', async (req, res) => {
  console.log(`${req.method} ${req.url} - 200`);
  
  // Run scraper immediately
  scrapeCourtAvailability();
  
  res.json({ success: true, message: 'Court check initiated' });
});

// Schedule court checking every 30 minutes
cron.schedule('*/30 * * * *', () => {
  log('Scheduled court check triggered');
  scrapeCourtAvailability();
});

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await loadData();
  log(`Court Monitor API started on port ${PORT}`);
  
  // Run initial check after 10 seconds
  setTimeout(() => {
    log('Running initial court availability check');
    scrapeCourtAvailability();
  }, 10000);
});