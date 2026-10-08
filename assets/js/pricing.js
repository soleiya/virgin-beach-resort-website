// Virgin Beach Resort — Day Trip pricing (2026 Rate Sheet).
// ONE calculation shared by the public booking form (booking.js) and the
// staff dashboard (staff-dashboard.js), so a staff-made booking is priced
// exactly like a guest's own. The booking emails rebuild the same bill
// server-side (supabase-functions/send-booking-email/index.ts — keep the
// rates there in sync with this file).
(function () {
  var SENIOR_DISCOUNT_RATE = 0.2; // 20% off a senior's own per-person fee only
  // RA 9994 / RA 10754 + RR 7-2010: a senior's own share is VAT-exempt and the
  // 20% comes off the VAT-exclusive price. Rates include 12% VAT + 5% service
  // charge on the net (net = price / 1.17); the service charge is kept.
  var VAT_RATE = 0.12, SERVICE_CHARGE_RATE = 0.05;
  function seniorPrice(price) {
    return r2(price / (1 + VAT_RATE + SERVICE_CHARGE_RATE) * (1 - SENIOR_DISCOUNT_RATE + SERVICE_CHARGE_RATE));
  }

  var PRICING = {
    day_trip: { adult: 1250, child612: 825, child05: 0, pet: 750, dining: 1500, lounge: 2000 },
    half_day: { adult: 800, child612: 550, child05: 0, pet: 375, dining: 750, lounge: 1000 },
  };
  var PACKAGE_PRICING = {
    all_inclusive_family: { base: 5000, includedPax: 4, includedCabanas: 1, addlAdult: 1250, addlChild: 825, addlPet: 750, addlCabana: 1000 },
    all_inclusive_barkada: { base: 10000, includedPax: 10, includedCabanas: 1, addlAdult: 1250, addlChild: 825, addlPet: 750, addlCabana: 1000 },
  };

  function int(v) { var n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : 0; }
  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  // Types with a rate sheet — everything else (Flash Sale, Corporate, Other)
  // is quoted by hand.
  function hasRateSheet(type) { return !!PRICING[type] || !!PACKAGE_PRICING[type]; }

  function cabanaPrice(type, c) {
    var r = PRICING[type];
    if (type === "half_day" && r) return String(c.cabana_type || "").indexOf("lounge") === 0 ? r.lounge : r.dining;
    return Number(c.price) || 0;
  }

  // p = { type, adults, kids612, kids05, seniors, pets, cabanas: [{price, capacity, cabana_type, label}] }
  function compute(p) {
    var type = p.type;
    var adults = int(p.adults), kids612 = int(p.kids612), kids05 = int(p.kids05);
    var seniors = Math.min(int(p.seniors), adults);
    var pets = int(p.pets);
    var cabanas = p.cabanas || [];
    var regularAdults = adults - seniors;
    var totalGuests = adults + kids612 + kids05;
    var cp = function (c) { return cabanaPrice(type, c); };
    var cabanaTotal = cabanas.reduce(function (s, c) { return s + cp(c); }, 0);
    var totalCapacity = cabanas.reduce(function (s, c) { return s + (Number(c.capacity) || 0); }, 0);
    var base = { type: type, adults: adults, kids612: kids612, kids05: kids05, seniors: seniors, pets: pets,
      regularAdults: regularAdults, totalGuests: totalGuests, cabanaTotal: cabanaTotal, totalCapacity: totalCapacity,
      cabanaPrice: cp, cabanas: cabanas, rated: hasRateSheet(type) };

    var pkg = PACKAGE_PRICING[type];
    if (pkg) {
      var extraPax = Math.max(0, totalGuests - pkg.includedPax);
      var extraCabanas = Math.max(0, cabanas.length - pkg.includedCabanas);
      var extraPaxCost = extraPax * pkg.addlAdult, extraPetCost = pets * pkg.addlPet, extraCabanaCost = extraCabanas * pkg.addlCabana;
      return Object.assign(base, {
        isPackage: true, base: pkg.base, includedPax: pkg.includedPax, includedCabanas: pkg.includedCabanas,
        extraPax: extraPax, extraPaxCost: extraPaxCost, extraPetCost: extraPetCost,
        extraCabanas: extraCabanas, extraCabanaCost: extraCabanaCost,
        subtotalPeople: pkg.base + extraPaxCost, seniorDiscount: 0,
        total: pkg.base + extraPaxCost + extraPetCost + extraCabanaCost,
      });
    }
    var rate = PRICING[type] || PRICING.day_trip;
    var seniorRate = seniorPrice(rate.adult);
    var subtotalPeople = regularAdults * rate.adult + seniors * seniorRate + kids612 * rate.child612 + kids05 * rate.child05;
    var petCost = pets * rate.pet;
    return Object.assign(base, {
      isPackage: false, rate: rate, seniorRate: seniorRate, subtotalPeople: subtotalPeople, petCost: petCost,
      seniorDiscount: r2(seniors * (rate.adult - seniorRate)),
      total: subtotalPeople + petCost + cabanaTotal,
    });
  }

  // Staff discount on top of the rate-sheet total.
  // kind: "percent" (value 0–100) or "amount" (₱). Never below zero.
  function discountAmount(total, kind, value) {
    var v = Number(value) || 0;
    if (v <= 0 || total <= 0) return 0;
    if (kind === "percent") return r2(total * Math.min(v, 100) / 100);
    if (kind === "amount") return r2(Math.min(v, total));
    return 0;
  }

  window.VBRPricing = {
    PRICING: PRICING, PACKAGE_PRICING: PACKAGE_PRICING, SENIOR_DISCOUNT_RATE: SENIOR_DISCOUNT_RATE, seniorPrice: seniorPrice,
    hasRateSheet: hasRateSheet, cabanaPrice: cabanaPrice, compute: compute, discountAmount: discountAmount, r2: r2,
  };
})();
