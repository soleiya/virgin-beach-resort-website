# -*- coding: utf-8 -*-
from build import page

body = """
<section class="page-hero" style="min-height:32vh;">
  <img src="../assets/images/day-trip.jpg" alt="Aerial view of Virgin Beach Resort">
  <div class="wrap page-hero-content">
    <span class="eyebrow">Payment</span>
    <h1>Upload Your Payment Proof</h1>
    <p class="lede">Already sent payment for your Day Trip booking? Upload your screenshot here and we'll mark your reservation as paid.</p>
  </div>
</section>

<section>
  <div class="wrap" style="max-width:640px;">
    <div id="payFormWrap">
      <form class="inquiry" id="payForm">
        <div>
          <label for="orderCode">Order ID</label>
          <input id="orderCode" type="text" required placeholder="e.g. VBR-1042" autocapitalize="characters">
          <p class="field-hint">Find this in the confirmation email we sent when you submitted your request.</p>
        </div>
        <div>
          <label for="payEmail">Email used on your booking</label>
          <input id="payEmail" type="email" required>
        </div>
        <div>
          <label>Payment screenshot</label>
          <label class="upload-drop" for="payFile">
            Tap to choose an image (JPG or PNG, under 10MB)
            <input id="payFile" type="file" accept="image/*" required>
          </label>
          <img id="payPreview" class="upload-preview" alt="">
        </div>
        <button class="btn btn-primary" type="submit" id="paySubmitBtn">Upload Payment Proof</button>
        <p class="field-hint">Our reservations team reviews uploads and updates your status &mdash; you'll hear back within 24 hours.</p>
      </form>
    </div>
    <div id="payStatus" class="form-status" hidden></div>
  </div>
</section>

<section class="band-tint center">
  <div class="wrap" style="max-width:560px; margin:0 auto;">
    <span class="eyebrow">Trouble uploading?</span>
    <h2>Send it to us directly</h2>
    <p class="prose mx-auto mt-lg">Message us on Facebook, or email your screenshot and Order ID to
    <a class="text-link" href="mailto:reservations@virginbeachresort.com">reservations@virginbeachresort.com</a>.</p>
  </div>
</section>

<script src="https://unpkg.com/@supabase/supabase-js@2"></script>
<script src="../assets/js/booking-config.js"></script>
<script src="../assets/js/payment-upload.js"></script>
"""

page("pay/index.html", "Upload Payment Proof", "Upload your payment screenshot for a Virgin Beach Resort Day Trip booking using your Order ID.", body)
