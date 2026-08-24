// Shared visual cabana map: fetches cabana inventory + per-date availability
// from Supabase and renders it as clickable hotspots laid directly over the
// resort's real Day Trip Area layout artwork (assets/images/cabana-map-bg.jpg)
// — a seat-plan-style picker where a guest can see exactly where a cabana
// sits relative to the beach, pool, and pavilion. Used by the public booking
// page (assets/js/booking.js) and, in a read-only form, by the staff
// dashboard's availability panel.
(function (global) {
  // Position of every real cabana on cabana-map-bg.jpg, as percentages of
  // the image's rendered width/height — measured directly from the resort's
  // VBR_Day_Trip_Layout.pdf (pixel-detected against the artwork, not
  // eyeballed), so it stays accurate regardless of display size.
  var CABANA_MAP_LAYOUT = [{"section":"A","cabana_type":"dining_cabana","number":1,"left":64.373,"top":84.115,"width":3.585,"height":5.364},{"section":"A","cabana_type":"dining_cabana","number":2,"left":74.182,"top":84.1,"width":3.727,"height":5.364},{"section":"A","cabana_type":"dining_cabana","number":3,"left":83.725,"top":84.117,"width":3.585,"height":5.364},{"section":"A","cabana_type":"dining_cabana","number":4,"left":59.358,"top":74.193,"width":3.755,"height":5.404},{"section":"A","cabana_type":"dining_cabana","number":5,"left":64.349,"top":74.238,"width":3.585,"height":5.404},{"section":"A","cabana_type":"dining_cabana","number":6,"left":69.267,"top":74.211,"width":3.755,"height":5.404},{"section":"A","cabana_type":"dining_cabana","number":7,"left":74.185,"top":74.238,"width":3.727,"height":5.404},{"section":"A","cabana_type":"dining_cabana","number":8,"left":79.165,"top":74.168,"width":3.585,"height":5.404},{"section":"A","cabana_type":"dining_cabana","number":9,"left":88.249,"top":74.216,"width":3.557,"height":5.404},{"section":"A","cabana_type":"dining_cabana","number":10,"left":64.327,"top":64.248,"width":3.755,"height":5.161},{"section":"A","cabana_type":"dining_cabana","number":11,"left":69.376,"top":64.243,"width":3.585,"height":5.161},{"section":"A","cabana_type":"dining_cabana","number":12,"left":74.302,"top":64.217,"width":3.585,"height":5.161},{"section":"A","cabana_type":"dining_cabana","number":14,"left":79.222,"top":64.235,"width":3.585,"height":5.161},{"section":"A","cabana_type":"dining_cabana","number":15,"left":83.756,"top":64.305,"width":3.585,"height":5.364},{"section":"A","cabana_type":"dining_cabana","number":16,"left":88.256,"top":64.228,"width":3.727,"height":5.364},{"section":"A","cabana_type":"dining_cabana","number":17,"left":69.225,"top":56.701,"width":3.755,"height":5.404},{"section":"A","cabana_type":"dining_cabana","number":18,"left":74.108,"top":56.498,"width":3.896,"height":5.608},{"section":"A","cabana_type":"dining_cabana","number":19,"left":79.1,"top":56.593,"width":3.727,"height":5.608},{"section":"A","cabana_type":"dining_cabana","number":20,"left":83.703,"top":56.715,"width":3.585,"height":5.404},{"section":"A","cabana_type":"dining_cabana","number":21,"left":88.277,"top":56.677,"width":3.557,"height":5.404},{"section":"A","cabana_type":"dining_cabana","number":22,"left":59.482,"top":64.311,"width":3.585,"height":4.957},{"section":"A","cabana_type":"lounge_cabana","number":1,"left":58.676,"top":84.107,"width":3.755,"height":5.364},{"section":"A","cabana_type":"lounge_cabana","number":2,"left":68.73,"top":84.101,"width":3.755,"height":5.364},{"section":"A","cabana_type":"lounge_cabana","number":3,"left":78.366,"top":84.083,"width":3.896,"height":5.364},{"section":"A","cabana_type":"lounge_cabana","number":4,"left":87.622,"top":84.103,"width":3.896,"height":5.364},{"section":"A","cabana_type":"lounge_cabana","number":5,"left":82.996,"top":74.03,"width":3.868,"height":5.608},{"section":"B","cabana_type":"dining_cabana","number":2,"left":12.175,"top":84.091,"width":3.727,"height":5.364},{"section":"B","cabana_type":"dining_cabana","number":3,"left":16.562,"top":84.104,"width":3.755,"height":5.364},{"section":"B","cabana_type":"dining_cabana","number":4,"left":21.113,"top":84.084,"width":3.727,"height":5.364},{"section":"B","cabana_type":"dining_cabana","number":6,"left":43.663,"top":84.137,"width":3.727,"height":5.364},{"section":"B","cabana_type":"dining_cabana","number":7,"left":6.246,"top":74.123,"width":3.755,"height":5.608},{"section":"B","cabana_type":"dining_cabana","number":8,"left":10.964,"top":74.072,"width":3.727,"height":5.608},{"section":"B","cabana_type":"dining_cabana","number":9,"left":15.614,"top":74.104,"width":3.727,"height":5.608},{"section":"B","cabana_type":"dining_cabana","number":10,"left":20.28,"top":74.223,"width":3.755,"height":5.404},{"section":"B","cabana_type":"dining_cabana","number":11,"left":25.008,"top":74.186,"width":3.727,"height":5.404},{"section":"B","cabana_type":"dining_cabana","number":12,"left":29.67,"top":74.203,"width":3.727,"height":5.404},{"section":"B","cabana_type":"dining_cabana","number":14,"left":34.342,"top":74.194,"width":3.727,"height":5.404},{"section":"B","cabana_type":"dining_cabana","number":15,"left":39.007,"top":74.229,"width":3.727,"height":5.404},{"section":"B","cabana_type":"dining_cabana","number":16,"left":43.671,"top":74.211,"width":3.727,"height":5.404},{"section":"B","cabana_type":"dining_cabana","number":17,"left":6.312,"top":64.095,"width":3.727,"height":5.364},{"section":"B","cabana_type":"dining_cabana","number":18,"left":11.052,"top":64.077,"width":3.585,"height":5.364},{"section":"B","cabana_type":"dining_cabana","number":19,"left":15.707,"top":64.086,"width":3.585,"height":5.364},{"section":"B","cabana_type":"dining_cabana","number":20,"left":20.311,"top":64.101,"width":3.755,"height":5.161},{"section":"B","cabana_type":"dining_cabana","number":21,"left":25.057,"top":64.166,"width":3.727,"height":5.161},{"section":"B","cabana_type":"dining_cabana","number":22,"left":29.772,"top":64.169,"width":3.585,"height":5.161},{"section":"B","cabana_type":"dining_cabana","number":23,"left":34.34,"top":64.173,"width":3.727,"height":5.161},{"section":"B","cabana_type":"dining_cabana","number":24,"left":39.106,"top":64.14,"width":3.557,"height":5.161},{"section":"B","cabana_type":"dining_cabana","number":25,"left":43.703,"top":64.079,"width":3.727,"height":5.364},{"section":"B","cabana_type":"lounge_cabana","number":1,"left":7.067,"top":83.862,"width":3.727,"height":5.608}];

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
