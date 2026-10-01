# -*- coding: utf-8 -*-
from build import page, PET_POLICY_ITEMS, asset_v

body = f"""
<section class="page-hero" style="min-height:32vh;">
  <img src="../assets/images/day-trip.jpg" alt="Aerial view of Virgin Beach Resort">
  <div class="wrap page-hero-content">
    <span class="eyebrow">Payment</span>
    <h1>Upload Payment &amp; Documents</h1>
    <p class="lede">Send us your payment screenshot &mdash; plus any Senior Citizen / PWD IDs and pet vaccination cards your booking needs.</p>
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
        <p class="field-hint" id="payLookup" hidden></p>
        <div>
          <label>Payment screenshot</label>
          <label class="upload-drop" for="payFile">
            Tap to choose an image (JPG or PNG, under 10MB)
            <input id="payFile" type="file" accept="image/*">
          </label>
          <img id="payPreview" class="upload-preview" alt="">
          <p class="field-hint" id="payFileHint" hidden>Not paid yet? You can upload your documents now and come back for the payment.</p>
        </div>
        <div id="docSeniorWrap" hidden>
          <label for="docSeniorFiles">Senior Citizen / PWD ID photo(s)</label>
          <input id="docSeniorFiles" type="file" accept="image/*" multiple>
          <p class="field-hint" id="docSeniorHint">One photo per senior citizen / PWD (or one photo with all IDs) &mdash; needed for the 20% discount. Please bring the ID(s) on the day too.</p>
        </div>
        <div id="docPetWrap" hidden>
          <label for="docPetFiles">Pet vaccination card(s)</label>
          <input id="docPetFiles" type="file" accept="image/*,application/pdf" multiple>
          <p class="field-hint" id="docPetHint">A clear photo of each pet's vaccination card, showing the pet's details and a current anti-rabies vaccination. Please bring the card(s) on the day too.</p>
          <div id="docPetPolicy">
            <details class="pet-policy">
              <summary>Read the Pet Policy</summary>
              <ol>
{PET_POLICY_ITEMS}
              </ol>
            </details>
            <label class="field-hint pet-agree">
              <input type="checkbox" id="docPetAgree">
              I agree to the Resort's Pet Policy and confirm my pet(s) are vaccinated, healthy and free of fleas and ticks.
            </label>
          </div>
        </div>
        <button class="btn btn-primary" type="submit" id="paySubmitBtn">Upload</button>
        <p class="field-hint">Our reservations team reviews uploads and updates your status &mdash; you'll hear back within one business day (office hours: 9:00 AM &ndash; 4:00 PM, Monday &ndash; Friday).</p>
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
<script src="../assets/js/booking-config.js?v={asset_v('assets/js/booking-config.js')}"></script>
<script src="../assets/js/payment-upload.js?v={asset_v('assets/js/payment-upload.js')}"></script>
"""

page("pay/index.html", "Upload Payment & Documents", "Upload your payment screenshot, Senior Citizen / PWD IDs and pet vaccination cards for a Virgin Beach Resort Day Trip booking using your Order ID.", body)
