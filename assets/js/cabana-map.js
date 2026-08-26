// Shared visual cabana map: fetches cabana inventory + per-date availability
// from Supabase and renders it as clickable hotspots laid directly over the
// resort's illustrated Day Trip Area map (assets/images/cabana-map-bg.jpg)
// — a seat-plan-style picker where a guest can see exactly where a cabana
// sits relative to the beach, pool, and pavilion. Used by the public booking
// page (assets/js/booking.js) and, in a read-only form, by the staff
// dashboard's availability panel.
(function (global) {
  // Position of every real cabana on cabana-map-bg.jpg, as percentages of
  // the image's rendered width/height — pixel-detected against the artwork
  // (color-thresholded + contour-matched per tile, not eyeballed), so it
  // stays accurate regardless of display size. Same 49 cabanas as before,
  // just repositioned to match the resort's updated map artwork.
  var CABANA_MAP_LAYOUT = [{"section":"A","cabana_type":"dining_cabana","number":1,"left":63.942,"top":51.827,"width":3.125,"height":2.5},{"section":"A","cabana_type":"dining_cabana","number":2,"left":73.438,"top":51.827,"width":3.125,"height":2.5},{"section":"A","cabana_type":"dining_cabana","number":3,"left":83.053,"top":51.827,"width":3.005,"height":2.5},{"section":"A","cabana_type":"dining_cabana","number":4,"left":59.255,"top":45.962,"width":3.245,"height":2.692},{"section":"A","cabana_type":"dining_cabana","number":5,"left":64.062,"top":45.769,"width":2.885,"height":2.885},{"section":"A","cabana_type":"dining_cabana","number":6,"left":68.99,"top":46.058,"width":3.365,"height":2.596},{"section":"A","cabana_type":"dining_cabana","number":7,"left":73.918,"top":45.962,"width":3.365,"height":2.692},{"section":"A","cabana_type":"dining_cabana","number":8,"left":78.726,"top":45.962,"width":3.245,"height":2.692},{"section":"A","cabana_type":"dining_cabana","number":9,"left":87.981,"top":46.154,"width":3.125,"height":2.5},{"section":"A","cabana_type":"dining_cabana","number":10,"left":64.183,"top":40.096,"width":3.125,"height":2.404},{"section":"A","cabana_type":"dining_cabana","number":11,"left":68.87,"top":40.096,"width":3.365,"height":2.5},{"section":"A","cabana_type":"dining_cabana","number":12,"left":73.918,"top":40.096,"width":3.245,"height":2.404},{"section":"A","cabana_type":"dining_cabana","number":14,"left":78.726,"top":40.0,"width":3.245,"height":2.404},{"section":"A","cabana_type":"dining_cabana","number":15,"left":83.173,"top":40.096,"width":3.245,"height":2.404},{"section":"A","cabana_type":"dining_cabana","number":16,"left":87.861,"top":40.096,"width":3.486,"height":2.5},{"section":"A","cabana_type":"dining_cabana","number":17,"left":69.231,"top":35.577,"width":2.885,"height":2.404},{"section":"A","cabana_type":"dining_cabana","number":18,"left":73.918,"top":35.577,"width":3.245,"height":2.404},{"section":"A","cabana_type":"dining_cabana","number":19,"left":78.846,"top":35.577,"width":3.125,"height":2.404},{"section":"A","cabana_type":"dining_cabana","number":20,"left":83.413,"top":35.577,"width":3.245,"height":2.404},{"section":"A","cabana_type":"dining_cabana","number":21,"left":87.74,"top":35.577,"width":3.606,"height":2.404},{"section":"A","cabana_type":"dining_cabana","number":22,"left":59.135,"top":40.096,"width":3.005,"height":2.404},{"section":"A","cabana_type":"lounge_cabana","number":1,"left":59.255,"top":51.827,"width":3.125,"height":2.5},{"section":"A","cabana_type":"lounge_cabana","number":2,"left":68.75,"top":51.827,"width":3.125,"height":2.5},{"section":"A","cabana_type":"lounge_cabana","number":3,"left":78.365,"top":51.827,"width":3.125,"height":2.5},{"section":"A","cabana_type":"lounge_cabana","number":4,"left":87.74,"top":51.827,"width":2.885,"height":2.5},{"section":"A","cabana_type":"lounge_cabana","number":5,"left":83.413,"top":46.058,"width":2.885,"height":2.5},{"section":"B","cabana_type":"dining_cabana","number":2,"left":12.62,"top":51.827,"width":3.125,"height":2.5},{"section":"B","cabana_type":"dining_cabana","number":3,"left":17.188,"top":51.827,"width":3.125,"height":2.5},{"section":"B","cabana_type":"dining_cabana","number":4,"left":21.635,"top":51.827,"width":2.885,"height":2.5},{"section":"B","cabana_type":"dining_cabana","number":6,"left":42.788,"top":51.827,"width":3.365,"height":2.596},{"section":"B","cabana_type":"dining_cabana","number":7,"left":6.01,"top":46.154,"width":3.125,"height":2.5},{"section":"B","cabana_type":"dining_cabana","number":8,"left":10.577,"top":46.154,"width":3.125,"height":2.596},{"section":"B","cabana_type":"dining_cabana","number":9,"left":15.024,"top":45.865,"width":3.245,"height":2.788},{"section":"B","cabana_type":"dining_cabana","number":10,"left":19.712,"top":45.962,"width":3.245,"height":2.692},{"section":"B","cabana_type":"dining_cabana","number":11,"left":24.279,"top":45.962,"width":3.365,"height":2.692},{"section":"B","cabana_type":"dining_cabana","number":12,"left":28.966,"top":45.962,"width":3.245,"height":2.692},{"section":"B","cabana_type":"dining_cabana","number":14,"left":33.293,"top":45.962,"width":3.486,"height":2.596},{"section":"B","cabana_type":"dining_cabana","number":15,"left":37.74,"top":45.962,"width":3.125,"height":2.692},{"section":"B","cabana_type":"dining_cabana","number":16,"left":42.668,"top":45.962,"width":3.245,"height":2.596},{"section":"B","cabana_type":"dining_cabana","number":17,"left":5.889,"top":40.0,"width":3.365,"height":2.596},{"section":"B","cabana_type":"dining_cabana","number":18,"left":10.457,"top":40.0,"width":3.245,"height":2.5},{"section":"B","cabana_type":"dining_cabana","number":19,"left":14.904,"top":40.096,"width":3.245,"height":2.5},{"section":"B","cabana_type":"dining_cabana","number":20,"left":19.471,"top":40.0,"width":3.606,"height":2.596},{"section":"B","cabana_type":"dining_cabana","number":21,"left":24.279,"top":40.0,"width":3.486,"height":2.5},{"section":"B","cabana_type":"dining_cabana","number":22,"left":28.846,"top":40.0,"width":3.486,"height":2.404},{"section":"B","cabana_type":"dining_cabana","number":23,"left":33.293,"top":40.0,"width":3.365,"height":2.5},{"section":"B","cabana_type":"dining_cabana","number":24,"left":37.74,"top":40.0,"width":3.365,"height":2.5},{"section":"B","cabana_type":"dining_cabana","number":25,"left":42.668,"top":40.0,"width":3.245,"height":2.5},{"section":"B","cabana_type":"lounge_cabana","number":1,"left":8.053,"top":51.827,"width":3.125,"height":2.692}];

  var MAP_IMAGE_SRC_DEFAULT = "../assets/images/cabana-map-bg.jpg";

  var TYPE_LABELS = {
    dining_cabana: "Dining Cabana",
    lounge_cabana: "Lounge Cabana",
  };

  var cabanaCache = null;

  function loadCabanas(sb) {
    if (cabanaCache) return Promise.resolve(cabanaCache);
    return sb
      .from("cabanas")
      .select("*")
      .order("section", { ascending: true })
      .order("row_index", { ascending: true })
      .order("col_index", { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        cabanaCache = res.data || [];
        return cabanaCache;
      });
  }

  // Returns a Set of cabana_id strings that are already held (booked, not
  // declined) for the given YYYY-MM-DD date.
  function loadHolds(sb, dateStr) {
    if (!dateStr) return Promise.resolve(new Set());
    return sb
      .from("public_cabana_holds")
      .select("cabana_id")
      .eq("check_in", dateStr)
      .then(function (res) {
        if (res.error) throw res.error;
        var set = new Set();
        (res.data || []).forEach(function (row) {
          if (row.cabana_id) set.add(row.cabana_id);
        });
        return set;
      });
  }

  function layoutFor(cabana) {
    for (var i = 0; i < CABANA_MAP_LAYOUT.length; i++) {
      var L = CABANA_MAP_LAYOUT[i];
      if (L.section === cabana.section && L.cabana_type === cabana.cabana_type && L.number === cabana.number) {
        return L;
      }
    }
    return null;
  }

  // opts: { cabanas, heldSet, heldInfo, selectedIds, onSelect(cabana), imageSrc }
  // heldInfo (optional): { [cabana_id]: "extra text for the tile's tooltip" }
  // — used by the staff dashboard to show who's holding a cabana; the public
  // booking page omits it and gets the generic "already booked" tooltip.
  // selectedIds (optional): a Set/array of cabana ids to show as selected —
  // a booking can include more than one cabana, so this is plural. onSelect
  // fires on every click (including on an already-selected tile, so the
  // caller can toggle it back off); held tiles never fire onSelect.
  function render(container, opts) {
    var cabanas = opts.cabanas || [];
    var heldSet = opts.heldSet || new Set();
    var heldInfo = opts.heldInfo || null;
    var selectedIds = opts.selectedIds ? new Set(opts.selectedIds) : new Set();
    var onSelect = opts.onSelect || function () {};
    var imageSrc = opts.imageSrc || MAP_IMAGE_SRC_DEFAULT;

    container.innerHTML = "";
    container.classList.add("cabana-map");

    var stage = document.createElement("div");
    stage.className = "cabana-map-stage";

    var img = document.createElement("img");
    img.className = "cabana-map-bg";
    img.src = imageSrc;
    img.alt = "Map of Section A and Section B cabanas at Virgin Beach Resort's Day Trip Area";
    img.draggable = false;
    stage.appendChild(img);

    var skipped = 0;
    cabanas.forEach(function (c) {
      var layout = layoutFor(c);
      if (!layout) {
        skipped++;
        return;
      }
      var isHeld = heldSet.has(c.id);
      var isSelected = selectedIds.has(c.id);
      var tile = document.createElement("button");
      tile.type = "button";
      tile.className =
        "cabana-hotspot cabana-" + c.cabana_type + (isHeld ? " is-held" : "") + (isSelected ? " is-selected" : "");
      tile.style.left = layout.left + "%";
      tile.style.top = layout.top + "%";
      tile.style.width = layout.width + "%";
      tile.style.height = layout.height + "%";
      var heldNote = isHeld ? (heldInfo && heldInfo[c.id] ? heldInfo[c.id] : "already booked for this date") : null;
      tile.title = c.label + (isHeld ? " — " + heldNote : " — available");
      tile.disabled = isHeld;
      tile.setAttribute("aria-pressed", isSelected ? "true" : "false");
      tile.setAttribute("aria-label", c.label);
      tile.addEventListener("click", function () {
        onSelect(c);
      });
      stage.appendChild(tile);
    });

    container.appendChild(stage);

    var legend = document.createElement("div");
    legend.className = "cabana-legend";
    legend.innerHTML =
      '<span><i class="cabana-swatch cabana-dining_cabana"></i> Dining Cabana</span>' +
      '<span><i class="cabana-swatch cabana-lounge_cabana"></i> Lounge Cabana</span>' +
      '<span><i class="cabana-swatch is-held"></i> Already booked</span>' +
      '<span><i class="cabana-swatch is-selected"></i> Your selection</span>';
    container.appendChild(legend);

    if (skipped && global.console) {
      console.warn("[VBRCabanaMap] " + skipped + " cabana(s) from the database have no known position on the map image.");
    }
  }

  global.VBRCabanaMap = {
    TYPE_LABELS: TYPE_LABELS,
    loadCabanas: loadCabanas,
    loadHolds: loadHolds,
    render: render,
  };
})(window);
