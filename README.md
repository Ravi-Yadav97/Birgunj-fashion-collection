# BIRGUNJ FASHION COLLECTION

Full-stack ecommerce website with a responsive storefront, OTP-based customer login, cart and checkout, COD/QR payment options, order tracking, returns/refunds, live chat queries, and an admin panel.

## Run Locally

```bash
npm install
PORT=5001 npm start
```

Open `http://localhost:5001`.

## Admin Login

Admin credentials are intentionally not published in this README.

Set or override them with environment variables when starting the app:

```bash
ADMIN_PHONE=<admin-phone> ADMIN_PASSWORD=<admin-password> PORT=5001 npm start
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

## Customer Email OTP

Customer login uses email OTP verification. For Gmail SMTP, create a Gmail app password and start the app with:

```bash
EMAIL_PROVIDER=gmail GMAIL_USER=<your-gmail-address> GMAIL_APP_PASSWORD=<gmail-app-password> PORT=5001 npm start
```

## Production Notes

The OTP flow generates a real six-digit OTP, stores it with expiry, and sends it to the customer's email. If Gmail SMTP is not configured or email sending fails, the OTP is not shown on screen and login is blocked until email sending is fixed.

QR payments are manual-verification payments. The admin can upload or paste a QR image and later mark payment status as verified from the order panel.
# Birgunj-fashion-collection
# Birgunj-fashion-collection
# Birgunj-fashion-collection
# Birgunj-fashion-collection
