# ════════════════════════════════════════════════════════════════
# services/notify_service.py — Notifications (WhatsApp + Email)
#
# Every WhatsApp and email notification the platform sends
# is written here as a named function.
#
# TO ADD A NEW NOTIFICATION:
#   1. Write a new async function at the bottom of this file
#   2. Call it with bg.add_task() in whichever router needs it
#   That's it. Nothing else changes.
#
# TO DISABLE NOTIFICATIONS TEMPORARILY:
#   Set NOTIFY_ENABLED = False below.
#   All notification calls will silently do nothing.
#
# TO SWAP PROVIDERS:
#   Replace the _send_whatsapp() or _send_email() internals.
#   All functions above them are untouched.
# ════════════════════════════════════════════════════════════════

import uuid
from datetime import datetime, timezone

from twilio.rest import Client as TwilioClient
import resend

from db import db_admin, get_one
from config import (
    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM,
    RESEND_API_KEY, RESEND_FROM_EMAIL, APP_URL,
)

# ── Master switch — set False to silence all notifications ───────
NOTIFY_ENABLED = True

# ── Lazy client initialisation ───────────────────────────────────
# Clients are created on first use so the app can start without
# credentials set (e.g. Railway before env vars are configured).
# Attempting to actually send a notification without valid keys
# will fail at call time, not at boot time — which is the correct
# behaviour (boot always succeeds; bad sends are logged, not fatal).
_twilio_client: TwilioClient | None = None


def _get_twilio() -> TwilioClient:
    global _twilio_client
    if _twilio_client is None:
        if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
            raise RuntimeError(
                "Twilio credentials not set. Add TWILIO_ACCOUNT_SID and "
                "TWILIO_AUTH_TOKEN to your environment variables."
            )
        _twilio_client = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    return _twilio_client


def _init_resend() -> None:
    """Set Resend API key on first use."""
    if not resend.api_key:
        resend.api_key = RESEND_API_KEY


# ════════════════════════════════════════════════════════════════
# INTERNAL HELPERS
# ════════════════════════════════════════════════════════════════

def _get_contact(profile_id: str) -> dict:
    """Fetch phone and email for a profile. Returns empty strings on fail."""
    profile = get_one("profiles", {"id": profile_id})
    if not profile:
        return {"phone": "", "email": "", "name": ""}
    return {
        "phone": profile.get("phone", ""),
        "email": profile.get("email", ""),
        "name":  profile.get("full_name", ""),
    }


async def _send_whatsapp(to_phone: str, body: str, event_type: str,
                          recipient_id: str = None) -> bool:
    """
    Send a WhatsApp message via Twilio.
    Logs every attempt to notification_log table.
    Returns True on success, False on failure.
    """
    if not NOTIFY_ENABLED or not to_phone:
        return False

    log_id    = str(uuid.uuid4())
    provider_id = None
    status    = "sent"
    error_msg = None

    try:
        msg = _get_twilio().messages.create(
            from_=TWILIO_WHATSAPP_FROM,
            to=f"whatsapp:{to_phone}",
            body=body,
        )
        provider_id = msg.sid
    except Exception as e:
        status    = "failed"
        error_msg = str(e)

    db_admin.table("notification_log").insert({
        "id":             log_id,
        "recipient_id":   recipient_id,
        "recipient_phone": to_phone,
        "channel":        "whatsapp",
        "event_type":     event_type,
        "body":           body,
        "provider_msg_id": provider_id,
        "status":         status,
        "error_msg":      error_msg,
        "sent_at":        datetime.now(timezone.utc).isoformat(),
    }).execute()

    return status == "sent"


async def _send_email(to_email: str, subject: str, html: str,
                       event_type: str, recipient_id: str = None) -> bool:
    """
    Send an email via Resend.
    Logs every attempt to notification_log table.
    Returns True on success, False on failure.
    """
    if not NOTIFY_ENABLED or not to_email:
        return False

    log_id    = str(uuid.uuid4())
    provider_id = None
    status    = "sent"
    error_msg = None

    try:
        _init_resend()
        result = resend.Emails.send({
            "from":    RESEND_FROM_EMAIL,
            "to":      [to_email],
            "subject": subject,
            "html":    html,
        })
        provider_id = result.get("id")
    except Exception as e:
        status    = "failed"
        error_msg = str(e)

    db_admin.table("notification_log").insert({
        "id":             log_id,
        "recipient_id":   recipient_id,
        "recipient_email": to_email,
        "channel":        "email",
        "event_type":     event_type,
        "subject":        subject,
        "body":           html,
        "provider_msg_id": provider_id,
        "status":         status,
        "error_msg":      error_msg,
        "sent_at":        datetime.now(timezone.utc).isoformat(),
    }).execute()

    return status == "sent"


# ════════════════════════════════════════════════════════════════
# ORDER NOTIFICATIONS
# ════════════════════════════════════════════════════════════════

async def notify_manufacturer_new_order(
    manufacturer_id: str,
    order_ref: str,
    design_title: str,
):
    """
    Fired when a new order is assigned to a manufacturer.
    Sent via WhatsApp + email.
    """
    contact = _get_contact(manufacturer_id)
    name    = contact["name"]

    wa_body = (
        f"Hi {name},\n\n"
        f"New order assigned: *{order_ref}*\n"
        f"Product: {design_title}\n\n"
        f"Open your dashboard to begin manufacturing:\n"
        f"{APP_URL}/manufacturer/dashboard"
    )
    email_html = f"""
    <h2>New Order Assigned — {order_ref}</h2>
    <p>Hi {name},</p>
    <p>A new order has been assigned to your workshop.</p>
    <table>
      <tr><td><b>Order Ref</b></td><td>{order_ref}</td></tr>
      <tr><td><b>Product</b></td><td>{design_title}</td></tr>
    </table>
    <p><a href="{APP_URL}/manufacturer/dashboard">Open Dashboard</a></p>
    <p>— GigaSouk</p>
    """

    await _send_whatsapp(contact["phone"], wa_body, "new_order", manufacturer_id)
    await _send_email(contact["email"], f"New Order: {order_ref}", email_html,
                      "new_order", manufacturer_id)


async def notify_customer_order_confirmed(
    customer_id: str,
    order_ref: str,
    distance_km: float,
):
    """
    Fired immediately after customer places an order.
    Tells them their product is being made nearby.
    """
    contact = _get_contact(customer_id)
    name    = contact["name"]

    wa_body = (
        f"Hi {name}, your order *{order_ref}* is confirmed!\n\n"
        f"Your product is being manufactured just *{distance_km}km away* from you.\n"
        f"Track your order: {APP_URL}/orders/{order_ref}"
    )
    email_html = f"""
    <h2>Order Confirmed — {order_ref}</h2>
    <p>Hi {name},</p>
    <p>Your order is confirmed and manufacturing will begin shortly.</p>
    <p><b>Your product is being made just {distance_km}km away.</b></p>
    <p><a href="{APP_URL}/orders/{order_ref}">Track Your Order</a></p>
    <p>— GigaSouk</p>
    """

    await _send_whatsapp(contact["phone"], wa_body, "order_confirmed", customer_id)
    await _send_email(contact["email"], f"Order Confirmed — {order_ref}", email_html,
                      "order_confirmed", customer_id)


async def notify_designer_order_placed(designer_id: str, order_ref: str):
    """Fired when an order is placed for the designer's product."""
    contact = _get_contact(designer_id)
    wa_body = (
        f"Hi {contact['name']},\n\n"
        f"Your design just got an order! 🎉\n"
        f"Order ref: *{order_ref}*\n"
        f"Your royalty will be credited on delivery.\n"
        f"{APP_URL}/designer/dashboard"
    )
    email_html = f"""
    <h2>New Sale — {order_ref}</h2>
    <p>Hi {contact['name']},</p>
    <p>Your design just received an order. Your royalty will be credited automatically on delivery.</p>
    <p><a href="{APP_URL}/designer/dashboard">View Dashboard</a></p>
    <p>— GigaSouk</p>
    """
    await _send_whatsapp(contact["phone"], wa_body, "designer_sale", designer_id)
    await _send_email(contact["email"], f"New Sale — {order_ref}", email_html,
                      "designer_sale", designer_id)


# ════════════════════════════════════════════════════════════════
# COMMITMENT PIPELINE NOTIFICATIONS
# ════════════════════════════════════════════════════════════════

async def notify_manufacturer_commit_invite(
    manufacturer_id: str,
    design_id: str,
    design_title: str,
    base_price: float,
):
    """
    Fired when a designer seeks commitments.
    Invites manufacturers to view the design and commit.
    """
    contact = _get_contact(manufacturer_id)
    wa_body = (
        f"Hi {contact['name']},\n\n"
        f"A new design is seeking manufacturers:\n"
        f"*{design_title}* — Base price: ₹{base_price:,.0f}\n\n"
        f"Review and commit here:\n"
        f"{APP_URL}/manufacturer/commitment-board/{design_id}"
    )
    email_html = f"""
    <h2>New Design Seeking Manufacturers</h2>
    <p>Hi {contact['name']},</p>
    <p>A designer is looking for manufacturers for their product:</p>
    <table>
      <tr><td><b>Design</b></td><td>{design_title}</td></tr>
      <tr><td><b>Base Price</b></td><td>₹{base_price:,.0f}</td></tr>
    </table>
    <p>If this matches your workshop's capabilities and margins, click below to commit.</p>
    <p><a href="{APP_URL}/manufacturer/commitment-board/{design_id}">View and Commit</a></p>
    <p>— GigaSouk</p>
    """
    await _send_whatsapp(contact["phone"], wa_body, "commit_invite", manufacturer_id)
    await _send_email(contact["email"], f"New Design Seeking Manufacturers: {design_title}",
                      email_html, "commit_invite", manufacturer_id)


async def notify_designer_commitment_received(
    designer_id: str,
    design_title: str,
    region_city: str,
    committed_price: float,
):
    """Fired when a manufacturer commits to the designer's design."""
    contact = _get_contact(designer_id)
    wa_body = (
        f"Hi {contact['name']},\n\n"
        f"A manufacturer in *{region_city}* has committed to your design:\n"
        f"*{design_title}* at ₹{committed_price:,.0f}\n\n"
        f"Check your staging area:\n"
        f"{APP_URL}/designer/dashboard"
    )
    email_html = f"""
    <h2>New Manufacturer Commitment</h2>
    <p>Hi {contact['name']},</p>
    <p>A manufacturer has committed to your design <b>{design_title}</b>.</p>
    <table>
      <tr><td><b>Region</b></td><td>{region_city}</td></tr>
      <tr><td><b>Committed Price</b></td><td>₹{committed_price:,.0f}</td></tr>
    </table>
    <p><a href="{APP_URL}/designer/dashboard">View Staging Area</a></p>
    <p>— GigaSouk</p>
    """
    await _send_whatsapp(contact["phone"], wa_body, "commitment_received", designer_id)
    await _send_email(contact["email"], f"New Commitment: {design_title}", email_html,
                      "commitment_received", designer_id)


async def notify_manufacturer_regional_variant_needed(
    designer_id: str,
    design_title: str,
    region_city: str,
    proposed_price: float,
    variant_id: str,
):
    """
    Fired when a manufacturer submits a regional price variant.
    Asks designer to approve or reject.
    """
    contact = _get_contact(designer_id)
    wa_body = (
        f"Hi {contact['name']},\n\n"
        f"A manufacturer in *{region_city}* wants to commit to "
        f"*{design_title}* at ₹{proposed_price:,.0f} (regional price).\n\n"
        f"Approve or reject here:\n"
        f"{APP_URL}/designer/variants/{variant_id}"
    )
    email_html = f"""
    <h2>Regional Price Variant — Action Required</h2>
    <p>Hi {contact['name']},</p>
    <p>A manufacturer in <b>{region_city}</b> wants to commit to <b>{design_title}</b>
    at a regional price of ₹{proposed_price:,.0f}.</p>
    <p>Please review and approve or reject this variant.</p>
    <p><a href="{APP_URL}/designer/variants/{variant_id}">Review Variant</a></p>
    <p>— GigaSouk</p>
    """
    await _send_whatsapp(contact["phone"], wa_body, "variant_pending", designer_id)
    await _send_email(contact["email"], f"Regional Price Variant — Review Required",
                      email_html, "variant_pending", designer_id)


async def notify_designer_design_live(designer_id: str, design_title: str):
    """Fired when a design is published and goes live in the shop."""
    contact = _get_contact(designer_id)
    wa_body = (
        f"🎉 Your design is now LIVE!\n\n"
        f"*{design_title}* is now visible to customers on gigasouk.com\n"
        f"Every sale earns you a royalty automatically.\n\n"
        f"{APP_URL}/shop"
    )
    email_html = f"""
    <h2>Your Design is Live! 🎉</h2>
    <p>Hi {contact['name']},</p>
    <p><b>{design_title}</b> is now live in the GigaSouk shop and visible to customers.</p>
    <p>You will earn a royalty automatically on every sale — no further action needed.</p>
    <p><a href="{APP_URL}/shop">View in Shop</a></p>
    <p>— GigaSouk</p>
    """
    await _send_whatsapp(contact["phone"], wa_body, "design_live", designer_id)
    await _send_email(contact["email"], f"Your Design is Live: {design_title}", email_html,
                      "design_live", designer_id)


# ════════════════════════════════════════════════════════════════
# PAYMENT NOTIFICATIONS
# ════════════════════════════════════════════════════════════════

async def notify_payment_received(manufacturer_id: str, order_ref: str):
    """Fired when customer's payment is confirmed in escrow."""
    contact = _get_contact(manufacturer_id)
    wa_body = (
        f"Payment received for order *{order_ref}*.\n"
        f"Funds are in escrow and will be released on delivery.\n"
        f"You can now begin manufacturing.\n\n"
        f"{APP_URL}/manufacturer/dashboard"
    )
    email_html = f"""
    <h2>Payment Confirmed — {order_ref}</h2>
    <p>Payment for order <b>{order_ref}</b> is now held in escrow.</p>
    <p>Funds will be released to your account after delivery confirmation.</p>
    <p><a href="{APP_URL}/manufacturer/dashboard">View Dashboard</a></p>
    <p>— GigaSouk</p>
    """
    await _send_whatsapp(contact["phone"], wa_body, "payment_received", manufacturer_id)
    await _send_email(contact["email"], f"Payment Confirmed — {order_ref}", email_html,
                      "payment_received", manufacturer_id)


async def notify_escrow_released(manufacturer_id: str, order_ref: str, amount: float):
    """Fired when escrow is released to manufacturer after delivery."""
    contact = _get_contact(manufacturer_id)
    wa_body = (
        f"💰 Payment released for order *{order_ref}*!\n\n"
        f"₹{amount:,.2f} has been transferred to your bank account.\n"
        f"(Transfer may take 1-3 business days)"
    )
    email_html = f"""
    <h2>Payment Released — {order_ref}</h2>
    <p>Hi {contact['name']},</p>
    <p>Your payment of <b>₹{amount:,.2f}</b> for order {order_ref} has been released.</p>
    <p>Transfer to your bank account may take 1-3 business days.</p>
    <p>— GigaSouk</p>
    """
    await _send_whatsapp(contact["phone"], wa_body, "escrow_released", manufacturer_id)
    await _send_email(contact["email"], f"Payment Released — {order_ref}", email_html,
                      "escrow_released", manufacturer_id)


# ════════════════════════════════════════════════════════════════
# QC AND SHIPPING NOTIFICATIONS
# ════════════════════════════════════════════════════════════════

async def notify_customer_qc_passed(customer_id: str, order_ref: str):
    """Fired when QC passes. Reassures customer before shipping."""
    contact = _get_contact(customer_id)
    wa_body = (
        f"✅ Quality check passed for your order *{order_ref}*!\n\n"
        f"Your part has been verified to be within tolerance.\n"
        f"Shipping is being arranged now."
    )
    email_html = f"""
    <h2>Quality Check Passed — {order_ref}</h2>
    <p>Hi {contact['name']},</p>
    <p>Your order has passed AI quality verification. Dimensions are within tolerance.</p>
    <p>Shipping is being arranged and you will receive a tracking link shortly.</p>
    <p>— GigaSouk</p>
    """
    await _send_whatsapp(contact["phone"], wa_body, "qc_passed", customer_id)
    await _send_email(contact["email"], f"Quality Verified — {order_ref}", email_html,
                      "qc_passed", customer_id)


async def notify_customer_shipped(customer_id: str, order_ref: str, tracking_url: str):
    """Fired when Shiprocket generates a tracking number."""
    contact = _get_contact(customer_id)
    wa_body = (
        f"📦 Your order *{order_ref}* has been shipped!\n\n"
        f"Track your delivery here:\n{tracking_url}"
    )
    email_html = f"""
    <h2>Your Order is Shipped — {order_ref}</h2>
    <p>Hi {contact['name']},</p>
    <p>Your order has been dispatched and is on its way.</p>
    <p><a href="{tracking_url}">Track Your Delivery</a></p>
    <p>— GigaSouk</p>
    """
    await _send_whatsapp(contact["phone"], wa_body, "order_shipped", customer_id)
    await _send_email(contact["email"], f"Shipped — {order_ref}", email_html,
                      "order_shipped", customer_id)


async def notify_admin_qc_failed(order_id: str, reason: str):
    """
    Fired when QC fails. Alerts admin for manual review.
    Replace admin_email below with your actual admin email.
    """
    admin_email = "anirudhsraj11@gmail.com"
    email_html = f"""
    <h2>QC Failed — Manual Review Required</h2>
    <p>Order ID: <b>{order_id}</b></p>
    <p>Reason: {reason}</p>
    <p><a href="{APP_URL}/admin/orders/{order_id}">Review in Admin Panel</a></p>
    """
    await _send_email(admin_email, f"QC Failed — {order_id[:8]}", email_html,
                      "qc_failed")


# ════════════════════════════════════════════════════════════════
# EMERGENCY BROADCAST NOTIFICATION
# ════════════════════════════════════════════════════════════════

async def notify_emergency_bid_invite(
    manufacturer_id: str,
    design_title: str,
    region_city: str,
    design_id: str,
):
    """
    Fired during Emergency Price Discovery.
    Invites local manufacturers to submit a regional bid.
    """
    contact = _get_contact(manufacturer_id)
    wa_body = (
        f"⚡ Urgent: Design needs a manufacturer in *{region_city}*!\n\n"
        f"*{design_title}* is live with customers but has no committed "
        f"manufacturer in your area.\n\n"
        f"Submit your regional price:\n"
        f"{APP_URL}/manufacturer/emergency/{design_id}"
    )
    email_html = f"""
    <h2>Urgent: Manufacturer Needed in {region_city}</h2>
    <p>Hi {contact['name']},</p>
    <p>The product <b>{design_title}</b> has active customer demand in your region
    but no committed manufacturer.</p>
    <p>Submit your regional price to start receiving these orders.</p>
    <p><a href="{APP_URL}/manufacturer/emergency/{design_id}">Submit Regional Price</a></p>
    <p>— GigaSouk</p>
    """
    await _send_whatsapp(contact["phone"], wa_body, "emergency_bid_invite", manufacturer_id)
    await _send_email(contact["email"], f"Urgent: Manufacturer Needed — {design_title}",
                      email_html, "emergency_bid_invite", manufacturer_id)
