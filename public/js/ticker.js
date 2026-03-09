// Random Indian-style usernames
const firstNames = [
  'Rahul', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Anjali', 'Rohit', 'Pooja',
  'Arjun', 'Neha', 'Karan', 'Divya', 'Suresh', 'Meera', 'Raj', 'Ananya',
  'Deepak', 'Riya', 'Manish', 'Kavita', 'Sanjay', 'Nisha', 'Aakash', 'Simran',
  'Varun', 'Tanvi', 'Nikhil', 'Shreya', 'Gaurav', 'Pallavi', 'Harsh', 'Swati',
  'Tushar', 'Ritika', 'Mohit', 'Sakshi', 'Pankaj', 'Komal', 'Vishal', 'Aisha'
];

const lastInitials = ['S', 'K', 'M', 'R', 'P', 'D', 'G', 'V', 'T', 'A', 'B', 'N', 'J', 'L', 'C'];

const machines = [
  { name: 'Basic Rig', icon: '🔧' },
  { name: 'Power Drill', icon: '🔨' },
  { name: 'Turbo Miner', icon: '⚡' },
  { name: 'Mega Machine', icon: '🏭' },
  { name: 'Ultra Excavator', icon: '🚀' },
  { name: 'Diamond Drill', icon: '💎' },
  { name: 'Quantum Miner', icon: '🌟' },
];

const spinPrizes = [
  { name: 'Basic Rig', icon: '🔧' },
  { name: 'Power Drill', icon: '🔨' },
  { name: 'Turbo Miner', icon: '⚡' },
  { name: 'Mega Machine', icon: '🏭' },
  { name: '₹500 Bonus', icon: '💰' },
  { name: '₹1,000 Bonus', icon: '💰' },
  { name: '₹200 Bonus', icon: '🎁' },
];

const games = [
  { name: 'Crypto Slots', icon: '🎰' },
  { name: 'Lucky Number', icon: '🎯' },
  { name: 'Dice Royale', icon: '🎲' }
];

const gameWinAmounts = [200, 500, 800, 1200, 2500, 4000, 6000, 10000];

const cities = [
  'Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata',
  'Pune', 'Jaipur', 'Lucknow', 'Ahmedabad', 'Surat', 'Indore',
  'Patna', 'Nagpur', 'Bhopal', 'Chandigarh', 'Kochi', 'Guwahati'
];

const intlFirstNames = ['John','Emily','Michael','Sofia','Daniel','Emma','Liam','Olivia','Noah','Ava','James','Mia','Lucas','Amelia','Ethan','Isabella','Benjamin','Charlotte','Henry','Chloe'];
const intlLastInitials = ['B','C','D','E','F','G','H','J','L','M','N','P','R','S','T','V','W','Z'];
const internationalCities = ['New York','London','Singapore','Dubai','Sydney','Toronto','Berlin','Tokyo','Paris','Madrid','Rome','Zurich','Doha','Kuala Lumpur','Hong Kong'];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomIntlName() {
  return `${randomFrom(intlFirstNames)} ${randomFrom(intlLastInitials)}.`;
}

function randomMinutesAgo() {
  return Math.floor(Math.random() * 58) + 2; // 2-60 mins ago
}

function generateRandomName() {
  return `${randomFrom(firstNames)} ${randomFrom(lastInitials)}.`;
}

const withdrawAmounts = [5000, 7500, 10000, 12500, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000];
const depositAmountsINR = [5000, 10000, 15000, 20000, 25000, 30000, 40000, 50000];
const depositAmountsUSDT = [100, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000];

function generateNotification() {
  const name = generateRandomName();
  const city = randomFrom(cities);
  const minsAgo = randomMinutesAgo();
  const type = Math.random();

  if (type < 0.20) {
    // Withdrew money
    const amt = randomFrom(withdrawAmounts);
    return `💸 <strong>${name}</strong> from ${city} withdrew <strong>₹${amt.toLocaleString()}</strong> — ${minsAgo} min ago`;
  } else if (type < 0.35) {
    // Deposited money (INR or USDT)
    const isUSDT = Math.random() > 0.5;
    if (isUSDT) {
      const amt = randomFrom(depositAmountsUSDT);
      const fname = generateRandomIntlName();
      const icity = randomFrom(internationalCities);
      return `💳 <strong>${fname}</strong> from ${icity} deposited <strong>${amt.toLocaleString()} USDT</strong> — ${minsAgo} min ago`;
    } else {
      const amt = randomFrom(depositAmountsINR);
      return `💳 <strong>${name}</strong> from ${city} deposited <strong>₹${amt.toLocaleString()}</strong> — ${minsAgo} min ago`;
    }
  } else if (type < 0.50) {
    // Bought a machine
    const machine = randomFrom(machines);
    return `🛒 <strong>${name}</strong> from ${city} just bought a <strong>${machine.icon} ${machine.name}</strong> — ${minsAgo} min ago`;
  } else if (type < 0.65) {
    // Won spin wheel
    const prize = randomFrom(spinPrizes);
    return `🎰 <strong>${name}</strong> won <strong>${prize.icon} ${prize.name}</strong> in Spin Wheel — ${minsAgo} min ago`;
  } else if (type < 0.85) {
    // Won a game
    const game = randomFrom(games);
    const amt = randomFrom(gameWinAmounts);
    return `🎮 <strong>${name}</strong> won <strong>₹${amt.toLocaleString()}</strong> in <strong>${game.icon} ${game.name}</strong> — ${minsAgo} min ago`;
  } else {
    // Joined the platform
    return `🎉 <strong>${name}</strong> from ${city} just joined MineProfit — ${minsAgo} min ago`;
  }
}

function initTicker() {
  const tickerTrack = document.getElementById('tickerTrack');
  if (!tickerTrack) return;

  // Generate 15 notifications for a smooth loop
  const notifications = [];
  for (let i = 0; i < 15; i++) {
    notifications.push(generateNotification());
  }

  // Double them for seamless looping
  const html = notifications.map(n => `<span class="ticker-item">${n}</span>`).join('');
  tickerTrack.innerHTML = html + html;

  // Refresh notifications every 60 seconds
  setInterval(() => {
    const fresh = [];
    for (let i = 0; i < 15; i++) {
      fresh.push(generateNotification());
    }
    const newHtml = fresh.map(n => `<span class="ticker-item">${n}</span>`).join('');
    tickerTrack.innerHTML = newHtml + newHtml;
  }, 60000);
}

// Auto-init
document.addEventListener('DOMContentLoaded', initTicker);
