import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock data configuration
const MOCK_CONFIG = {
    count: 15,
    highSeverityRate: 0.4, // 40% are high severity
    negativeDeviationRate: 0.6 // 60% are negative (underperforming)
};

function generateMockTracking() {
    console.log('Generating mock tracking data...');

    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
    const trackingDate = today.toISOString().split('T')[0];

    // Simulate mid-month (15th)
    const dayOfMonth = 15;
    const daysInMonth = new Date(year, month, 0).getDate();
    const progressRatio = dayOfMonth / daysInMonth;

    const deviations = [];

    // Sample product names and SKUs
    const products = [
        { sku: 'SKU001', name: 'Premium Leather Wallet' },
        { sku: 'SKU002', name: 'Wireless Bluetooth Earbuds' },
        { sku: 'SKU003', name: 'Smart Fitness Tracker' },
        { sku: 'SKU004', name: 'Ergonomic Office Chair' },
        { sku: 'SKU005', name: 'Stainless Steel Water Bottle' },
        { sku: 'SKU006', name: 'Noise Cancelling Headphones' },
        { sku: 'SKU007', name: 'Portable Power Bank 20000mAh' },
        { sku: 'SKU008', name: 'Mechanical Keyboard (Red Switch)' },
        { sku: 'SKU009', name: '4K Webcam with Microphone' },
        { sku: 'SKU010', name: 'Gaming Mouse 16000 DPI' },
        { sku: 'SKU011', name: 'Laptop Stand Aluminum' },
        { sku: 'SKU012', name: 'USB-C Hub 7-in-1' },
        { sku: 'SKU013', name: 'Graphic Drawing Tablet' },
        { sku: 'SKU014', name: 'Smart Home LED Bulb' },
        { sku: 'SKU015', name: 'Resistance Bands Set' }
    ];

    for (let i = 0; i < products.length; i++) {
        const product = products[i];

        // Random forecast between 1000 and 10000
        const forecastValue = Math.round(1000 + Math.random() * 9000);
        const expectedProgress = Math.round(forecastValue * progressRatio);

        // Random deviation (-80% to +80%)
        // Ensure it's outside ±20% to be tracked
        let randomDev;
        do {
            randomDev = (Math.random() * 1.6) - 0.8;
        } while (Math.abs(randomDev) < 0.25); // At least 25% deviation

        const actualCumulative = Math.round(expectedProgress * (1 + randomDev));

        // Calculate derived metrics
        const achievementRate = expectedProgress > 0 ? (actualCumulative / expectedProgress) * 100 : 100;
        const deviationRate = achievementRate - 100;
        const severity = Math.abs(deviationRate) > 30 ? 'high' : 'medium';
        const suggestion = deviationRate < 0 ? 'decrease' : 'increase';
        const adjustmentAmount = Math.round(Math.abs(forecastValue * deviationRate / 100));

        deviations.push({
            sku_id: product.sku,
            product_name: product.name,
            tracking_date: trackingDate,
            forecast_value: forecastValue,
            expected_progress: expectedProgress,
            actual_cumulative: actualCumulative,
            achievement_rate: Math.round(achievementRate),
            deviation_rate: Math.round(deviationRate),
            suggestion: suggestion,
            adjustment_amount: adjustmentAmount,
            severity: severity
        });
    }

    // Sort by severity (high first) then by absolute deviation
    deviations.sort((a, b) => {
        if (a.severity === 'high' && b.severity !== 'high') return -1;
        if (a.severity !== 'high' && b.severity === 'high') return 1;
        return Math.abs(b.deviation_rate) - Math.abs(a.deviation_rate);
    });

    const trackingData = {
        current_month: currentMonth,
        last_tracking_date: trackingDate,
        tracking_time: today.toISOString(),
        progress_ratio: Math.round(progressRatio * 100),
        deviations: deviations,
        unread_alerts: deviations.length,
        summary: {
            total_skus: 91, // Updated to match monthly forecast total
            deviation_count: deviations.length,
            high_severity: deviations.filter(d => d.severity === 'high').length,
            medium_severity: deviations.filter(d => d.severity === 'medium').length
        }
    };

    const outputPath = path.join(__dirname, 'public', 'forecast_tracking.json');

    // Ensure public dir exists
    const publicDir = path.join(__dirname, 'public');
    if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(trackingData, null, 2));

    console.log(`Successfully generated mock tracking data at: ${outputPath}`);
    console.log(`- Total deviations: ${deviations.length}`);
    console.log(`- High severity: ${trackingData.summary.high_severity}`);
    console.log(`- Medium severity: ${trackingData.summary.medium_severity}`);
}

generateMockTracking();
