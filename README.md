# BIRGUNJ FASHION COLLECTION

Full-stack ecommerce website with a responsive storefront, OTP-based customer login, cart and checkout, COD/QR payment options, order tracking, returns/refunds, live chat queries, and an admin panel.

## Run Locally

```bash
npm install
PORT=5001 npm start
```

Open `http://localhost:5001`.

## Admin Login

- Phone: `9800000000`
- Password: `admin123`

You can override these with environment variables:

```bash
ADMIN_PHONE=9800000000 ADMIN_PASSWORD=your-password PORT=5001 npm start
```

## Data Storage

The local database is stored at `backend/data/db.json`.

It stores:
- users and OTP records
- products
- orders and order tracking
- payment history
- return/refund requests
- live chat messages
- editable About/Services content and QR payment settings

## Production Notes

The OTP flow generates a real six-digit OTP and stores it with expiry. In local demo mode the OTP is returned in the API response so the app can be tested without SMS credentials. For production, connect an SMS provider inside `/api/auth/request-otp` and stop returning `demoOtp`.

QR payments are manual-verification payments. The admin can upload or paste a QR image and later mark payment status as verified from the order panel.
# Birgunj-fashion-collection
# Birgunj-fashion-collection
# Birgunj-fashion-collection
