import React, { useEffect, useRef, useState } from "react";
import {
  Search,
  MapPin,
  ChevronDown,
  ShoppingBag,
  Plus,
  Minus,
  Star,
  Clock,
  Heart,
  X,
  Check,
  UtensilsCrossed,
  SlidersHorizontal,
  Leaf,
  Flame,
  TicketPercent,
  CheckCircle2,
  Activity,
  RefreshCw,
} from "lucide-react";
type Item = {
  id: string;
  name: string;
  category: string;
  price: number;
  description: string;
  image: string;
  tag: string;
  rating: number;
  calories: number;
  veg: boolean;
};
type Session = {
  id: string;
  version: "original" | "redesign";
  source: string;
  preview: boolean;
  build: string;
};
type Order = { id: string; total: number; simulated: boolean };
const preview = new URLSearchParams(location.search).get("preview");
const headers = {
  "Content-Type": "application/json",
  ...(["original", "redesign"].includes(preview || "")
    ? { "X-Bite-Preview": preview! }
    : {}),
};
const money = (n: number) => "₹" + n.toLocaleString("en-IN");
const read = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
};
export function App() {
  const [items, setItems] = useState<Item[]>([]),
    [categories, setCategories] = useState<string[]>([]),
    [session, setSession] = useState<Session | null>(null);
  const [category, setCategory] = useState("All"),
    [query, setQuery] = useState(""),
    [veg, setVeg] = useState(false),
    [topRated, setTopRated] = useState(false),
    [sort, setSort] = useState("popular");
  const [cart, setCart] = useState<Record<string, number>>(() =>
      read("bite.cart", {}),
    ),
    [saved, setSaved] = useState<string[]>(() => read("bite.saved", [])),
    [onlySaved, setOnlySaved] = useState(false);
  const [detail, setDetail] = useState<Item | null>(null),
    [modal, setModal] = useState<
      "about" | "location" | "checkout" | "activity" | null
    >(null),
    [address, setAddress] = useState(() =>
      read("bite.address", "Connaught Place, New Delhi"),
    );
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [order, setOrder] = useState<Order | null>(null),
    [activity, setActivity] = useState<any>(null);
  const orderKey = useRef(crypto.randomUUID()),
    cartRef = useRef<HTMLElement>(null);
  async function api(path: string, options: RequestInit = {}) {
    const r = await fetch(path, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Request failed");
    return data;
  }
  async function event(name: string, itemId?: string) {
    const payload = { id: crypto.randomUUID(), name, itemId };
    try {
      await api("/api/events", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch (e) {
      if (String(e).includes("Session expired")) {
        try {
          const s = await api("/api/session");
          setSession(s);
          await api("/api/events", {
            method: "POST",
            body: JSON.stringify(payload),
          });
        } catch {
          setError("Activity could not be saved. Please refresh.");
        }
      } else
        setError("Activity could not be saved. Please check the local server.");
    }
  }
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [data, s] = await Promise.all([
          api("/api/menu"),
          api("/api/session"),
        ]);
        if (!active) return;
        setItems(data.menu);
        setCategories(data.categories);
        setSession(s);
        await event("page_view");
      } catch {
        if (active)
          setError(
            "Bite could not connect. Make sure the local server is running.",
          );
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    localStorage.setItem("bite.cart", JSON.stringify(cart));
    orderKey.current = crypto.randomUUID();
  }, [cart]);
  useEffect(() => {
    localStorage.setItem("bite.saved", JSON.stringify(saved));
  }, [saved]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    let last = 0;
    const touch = () => {
      last = Date.now();
    };
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - last < 15_000)
        void event("active_time");
    }, 15_000);
    return () => {
      clearInterval(t);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, []);
  const validCart = Object.fromEntries(
    Object.entries(cart).filter(
      ([id, n]) =>
        items.some((x) => x.id === id) &&
        Number.isInteger(n) &&
        n > 0 &&
        n <= 20,
    ),
  );
  const cartItems = items.filter((x) => validCart[x.id]),
    count = Object.values(validCart).reduce((a, b) => a + b, 0),
    subtotal = cartItems.reduce((n, x) => n + x.price * validCart[x.id], 0),
    delivery = subtotal >= 499 ? 0 : 29;
  const visible = items
    .filter(
      (x) =>
        (category === "All" || x.category === category) &&
        (!veg || x.veg) &&
        (!topRated || x.rating >= 4.8) &&
        (!onlySaved || saved.includes(x.id)) &&
        `${x.name} ${x.category} ${x.description}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "price"
        ? a.price - b.price
        : sort === "rating"
          ? b.rating - a.rating
          : 0,
    );
  function add(item: Item) {
    if ((cart[item.id] || 0) >= 20) {
      setToast("Maximum 20 per item");
      return;
    }
    setCart((c) => ({ ...c, [item.id]: (c[item.id] || 0) + 1 }));
    void event("add_to_cart", item.id);
    setToast(`${item.name} added to your bag`);
  }
  function remove(item: Item) {
    setCart((c) => {
      const next = { ...c };
      if (next[item.id] > 1) next[item.id]--;
      else delete next[item.id];
      return next;
    });
    void event("remove_from_cart", item.id);
  }
  function openDetail(item: Item) {
    setDetail(item);
    void event("item_click", item.id);
  }
  function toggleSaved(id: string) {
    setSaved((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  function resetFilters() {
    setCategory("All");
    setQuery("");
    setVeg(false);
    setTopRated(false);
    setOnlySaved(false);
  }
  function openCheckout() {
    setOrder(null);
    setModal("checkout");
    void event("checkout_start");
  }
  async function placeOrder() {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({ key: orderKey.current, cart: validCart }),
      });
      setOrder(result);
      setCart({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not place order");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (modal !== "activity") return;
    let active = true;
    const refresh = async () => {
      try {
        const result = await api("/api/activity");
        if (active) setActivity(result);
      } catch {
        if (active) setError("Cannot load activity.");
      }
    };
    void refresh();
    const t = setInterval(refresh, 2000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [modal]);
  const redesigned = session?.version === "redesign";
  return (
    <div className={redesigned ? "app redesign" : "app original"}>
      <div className="lab-bar">
        <span>
          <span className="lab-dot" />
          RELEASEPILOT PLAYGROUND
        </span>
        <span className="lab-mode">
          {session?.preview
            ? "Comparison preview · excluded from release metrics"
            : session?.source === "flagsmith"
              ? "Live Flagsmith assignment"
              : "Flagsmith pending · safe original"}
        </span>
        <div className="version-toggle" aria-label="Compare page versions">
          <a
            className={preview === "original" ? "selected" : ""}
            href="/?preview=original"
          >
            Original
          </a>
          <a
            className={preview === "redesign" ? "selected" : ""}
            href="/?preview=redesign"
          >
            Redesign
          </a>
          <button
            onClick={() => setModal("activity")}
            title="View recorded activity"
            aria-label="View recorded activity"
          >
            <Activity size={15} />
          </button>
        </div>
      </div>
      <header className="header">
        <div className="header-inner">
          <a className="logo" href="/" aria-label="Bite home">
            <span className="logo-icon">
              <UtensilsCrossed size={22} />
            </span>
            bite<span className="logo-dot">.</span>
          </a>
          <span className="header-divider" />
          <button
            className="location-button"
            onClick={() => setModal("location")}
          >
            <MapPin size={19} />
            <span>
              <small>Delivering to</small>
              <strong>{address}</strong>
            </span>
            <ChevronDown size={16} />
          </button>
          <nav>
            <button
              className={!onlySaved ? "nav-active" : ""}
              onClick={() => {
                resetFilters();
                document
                  .getElementById("menu")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              Discover
            </button>
            <button
              className={onlySaved ? "nav-active" : ""}
              onClick={() => {
                resetFilters();
                setOnlySaved(true);
                document
                  .getElementById("menu")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              Favourites{" "}
              {saved.length > 0 && (
                <span className="save-count">{saved.length}</span>
              )}
            </button>
            <button onClick={() => setModal("about")}>How it works</button>
          </nav>
          <button
            className="bag-button"
            onClick={() =>
              cartRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              })
            }
          >
            <ShoppingBag size={18} />
            <span>Your bag</span>
            <b>{count}</b>
          </button>
        </div>
      </header>
      <main>
        <section className="hero">
          <div className="hero-content">
            <div className="hero-eyebrow">
              <span /> YOUR NEIGHBOURHOOD, SERVED FRESH
            </div>
            <h1>
              Good food.
              <br />
              Great <em>mood.</em>
            </h1>
            <p>
              Your everyday favourites, a little extraordinary.
              <br />
              Freshly made. Full of flavour. On your doorstep.
            </p>
            <button
              className="primary hero-cta"
              onClick={() =>
                document
                  .getElementById("menu")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
            >
              Find your next favourite <UtensilsCrossed size={17} />
            </button>
            <div className="hero-social">
              <div className="avatars">
                <span>A</span>
                <span>M</span>
                <span>R</span>
              </div>
              <div>
                <span className="stars">★★★★★</span>
                <small>Your new lunch-break ritual.</small>
              </div>
            </div>
          </div>
          <div className="hero-art">
            <div className="hero-ring" />
            <img
              src="/food/bowl.jpg"
              alt="Fresh colourful bowl with vegetables and grains"
            />
            <div className="hero-sticker">
              <Leaf size={20} />
              <span>
                GOOD FOOD
                <br />
                <strong>no compromises.</strong>
              </span>
            </div>
            <div className="floating-review">
              <Star size={17} fill="currentColor" />
              <strong>Made with love</strong>
              <span>Always fresh, never boring.</span>
            </div>
            <span className="hero-spark">✳</span>
          </div>
        </section>
        <section className="restaurant">
          <div className="restaurant-mark">
            <Flame size={27} />
          </div>
          <div className="restaurant-title">
            <div className="restaurant-name">
              <h2>The Daily Kitchen</h2>
              <span className="open-label">Open now</span>
            </div>
            <p>Burgers, bowls & a little bit of everything you love.</p>
            <div className="restaurant-meta">
              <span>
                <Star size={14} fill="currentColor" />
                4.8 <small>sample menu rating</small>
              </span>
              <i />
              <span>
                <Clock size={15} />
                30–40 min <small>demo estimate</small>
              </span>
              <i />
              <span>₹200 for one</span>
            </div>
          </div>
          <button className="about-link" onClick={() => setModal("about")}>
            About this kitchen <ChevronDown size={15} />
          </button>
        </section>
        <section className="offer">
          <div className="offer-icon">
            <TicketPercent size={24} />
          </div>
          <div>
            <strong>A little treat on us.</strong>
            <span>Free delivery on orders of ₹499 or more.</span>
          </div>
          <span className="offer-code">NO CODE NEEDED</span>
        </section>
        <div className="workspace">
          <section className="menu-section" id="menu">
            <div className="section-heading">
              <div>
                <span className="eyebrow">FRESH OFF THE MENU</span>
                <h2>
                  {onlySaved ? "Your favourites." : "What are you craving?"}
                </h2>
              </div>
              <span className="menu-count">{visible.length} good choices</span>
            </div>
            <div className="menu-tools">
              <label className="search-box">
                <Search size={18} />
                <input
                  aria-label="Search the menu"
                  value={query}
                  placeholder="Search for your next favourite…"
                  onChange={(e) => setQuery(e.target.value)}
                  onBlur={() => {
                    if (query) void event("search");
                  }}
                />
                {query && (
                  <button
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                  >
                    <X size={16} />
                  </button>
                )}
              </label>
              <label className="sort-control">
                <SlidersHorizontal size={16} />
                <select
                  aria-label="Sort menu"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="popular">Popular first</option>
                  <option value="price">Price: low to high</option>
                  <option value="rating">Highest rated</option>
                </select>
                <ChevronDown size={13} />
              </label>
            </div>
            <div className="category-tabs" aria-label="Food categories">
              {categories.map((c) => (
                <button
                  key={c}
                  aria-pressed={category === c}
                  className={category === c ? "active" : ""}
                  onClick={() => {
                    setCategory(c);
                    void event("category_change");
                  }}
                >
                  {c === "All" ? (
                    <UtensilsCrossed size={15} />
                  ) : c === "Burgers" ? (
                    "🍔"
                  ) : c === "Pizza" ? (
                    "🍕"
                  ) : c === "Bowls" ? (
                    "🥗"
                  ) : c === "Indian" ? (
                    "🍛"
                  ) : c === "Sides" ? (
                    "🍟"
                  ) : (
                    "🍋"
                  )}{" "}
                  {c === "All" ? "All favourites" : c}
                </button>
              ))}
            </div>
            <div className="quick-filters">
              <button
                aria-pressed={veg}
                className={veg ? "on" : ""}
                onClick={() => setVeg(!veg)}
              >
                <span className="veg-mark">
                  <i />
                </span>
                Veg only
              </button>
              <button
                aria-pressed={topRated}
                className={topRated ? "on" : ""}
                onClick={() => setTopRated(!topRated)}
              >
                <Star size={13} />
                Rated 4.8+
              </button>
              {(veg || topRated || onlySaved) && (
                <button className="clear-filters" onClick={resetFilters}>
                  Clear filters
                </button>
              )}
            </div>
            {error && (
              <div className="error-banner" role="alert">
                {error}
                <button onClick={() => setError("")} aria-label="Dismiss error">
                  <X size={16} />
                </button>
              </div>
            )}
            {!session && !error ? (
              <div className="loading-state">
                <RefreshCw className="spin" /> Getting the kitchen ready…
              </div>
            ) : (
              <div className="food-grid">
                {visible.map((item) => (
                  <article className="food-card" key={item.id}>
                    <div className="food-photo">
                      <button
                        className="photo-button"
                        onClick={() => openDetail(item)}
                        aria-label={`View ${item.name}`}
                      >
                        <img src={item.image} alt={item.name} loading="lazy" />
                      </button>
                      <span className="food-tag">
                        {item.tag === "Bestseller" && <Flame size={12} />}{" "}
                        {item.tag}
                      </span>
                      <button
                        className={
                          "heart-button " +
                          (saved.includes(item.id) ? "is-saved" : "")
                        }
                        onClick={() => toggleSaved(item.id)}
                        aria-label={`${saved.includes(item.id) ? "Unsave" : "Save"} ${item.name}`}
                        aria-pressed={saved.includes(item.id)}
                      >
                        <Heart
                          size={17}
                          fill={
                            saved.includes(item.id) ? "currentColor" : "none"
                          }
                        />
                      </button>
                    </div>
                    <div className="food-info">
                      <div className="food-topline">
                        <span
                          className={"veg-mark " + (!item.veg ? "nonveg" : "")}
                        >
                          <i />
                        </span>
                        <span className="food-rating">
                          <Star size={12} fill="currentColor" />
                          {item.rating.toFixed(1)}
                        </span>
                      </div>
                      <button
                        className="food-name"
                        onClick={() => openDetail(item)}
                      >
                        {item.name}
                      </button>
                      <p>{item.description}</p>
                      <div className="food-bottom">
                        <strong>{money(item.price)}</strong>
                        {validCart[item.id] ? (
                          <Quantity
                            item={item}
                            quantity={validCart[item.id]}
                            onAdd={() => add(item)}
                            onRemove={() => remove(item)}
                          />
                        ) : (
                          <button
                            className="add-button"
                            aria-label={`Add ${item.name}`}
                            onClick={() => add(item)}
                          >
                            Add <Plus size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {session && visible.length === 0 && (
              <div className="empty-results">
                <Search size={30} />
                <h3>No bites found.</h3>
                <p>Try another search or explore the full menu.</p>
                <button className="primary" onClick={resetFilters}>
                  Show all favourites
                </button>
              </div>
            )}
            <div className="menu-note">
              <Leaf size={16} />
              <span>Prepared fresh. Packed thoughtfully. Enjoyed happily.</span>
            </div>
          </section>
          <aside className="cart-panel" ref={cartRef}>
            <div className="cart-heading">
              <div>
                <h2>Your good mood bag</h2>
                <p>
                  {count
                    ? `${count} ${count === 1 ? "item" : "items"} · freshly made for you`
                    : "Good things are about to happen."}
                </p>
              </div>
              <ShoppingBag size={22} />
            </div>
            {!count ? (
              <div className="empty-cart">
                <div className="empty-cart-illustration">
                  <ShoppingBag size={45} />
                  <span>✦</span>
                  <i>+</i>
                </div>
                <h3>A little empty in here.</h3>
                <p>
                  Pick something delicious.
                  <br />
                  We’ll save you a spot right here.
                </p>
                <div className="empty-cart-divider" />
                <span className="cart-promise">
                  <Leaf size={14} /> A fresh start to a better day.
                </span>
              </div>
            ) : (
              <>
                <div className="cart-lines">
                  {cartItems.map((item) => (
                    <div className="cart-line" key={item.id}>
                      <img src={item.image} alt="" />
                      <div>
                        <strong>{item.name}</strong>
                        <small>{money(item.price)}</small>
                        <Quantity
                          item={item}
                          quantity={validCart[item.id]}
                          onAdd={() => add(item)}
                          onRemove={() => remove(item)}
                        />
                      </div>
                      <b>{money(item.price * validCart[item.id])}</b>
                    </div>
                  ))}
                </div>
                <div className="bill">
                  <div>
                    <span>Item total</span>
                    <span>{money(subtotal)}</span>
                  </div>
                  <div>
                    <span>Delivery</span>
                    <span>
                      {delivery ? (
                        money(delivery)
                      ) : (
                        <b className="free">On us</b>
                      )}
                    </span>
                  </div>
                  <div className="bill-total">
                    <strong>To pay</strong>
                    <strong>{money(subtotal + delivery)}</strong>
                  </div>
                </div>
                {delivery > 0 && (
                  <p className="delivery-nudge">
                    Add {money(499 - subtotal)} more for free delivery.
                  </p>
                )}
                <button
                  className="primary checkout-button"
                  onClick={openCheckout}
                >
                  Review order <span>{money(subtotal + delivery)}</span>
                </button>
                <p className="demo-note">Demo checkout · no payment required</p>
              </>
            )}
            <div className="cart-footer">
              <CheckCircle2 size={16} /> A little happiness, delivered.
            </div>
          </aside>
        </div>
        <footer className="footer">
          <a href="/" className="logo">
            bite<span className="logo-dot">.</span>
          </a>
          <p>Made for good food. Built for safer releases.</p>
          <span>
            Local demo by ReleasePilot <span>·</span> No real orders
          </span>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
        </div>
      )}
      {detail && (
        <Modal title={detail.name} close={() => setDetail(null)}>
          <img className="detail-image" src={detail.image} alt={detail.name} />
          <div className="detail-facts">
            <span>
              <Star size={14} />
              {detail.rating} sample rating
            </span>
            <span>{detail.calories} kcal</span>
            <span>{detail.veg ? "Vegetarian" : "Non-vegetarian"}</span>
          </div>
          <p>{detail.description}</p>
          <button
            className="primary modal-action"
            onClick={() => {
              add(detail);
              setDetail(null);
            }}
          >
            Add to bag <span>{money(detail.price)}</span>
          </button>
        </Modal>
      )}
      {modal === "about" && (
        <Modal title="Your neighbourhood kitchen." close={() => setModal(null)}>
          <p>
            One kitchen. Your everyday favourites. Bite brings together
            comforting bowls, smashed burgers and fresh pizza in one easy menu.
          </p>
          <div className="about-facts">
            <span>
              <Leaf />
              Prepared fresh
            </span>
            <span>
              <Clock />
              30–40 min demo estimate
            </span>
            <span>
              <Heart />
              Made with care
            </span>
          </div>
          <div className="info-callout">
            <strong>A real app. A simulated kitchen.</strong>
            <p>
              Bite is the local website used to test ReleasePilot’s progressive
              releases. Cart and checkout work, but no food is dispatched and no
              money is collected. Ratings and delivery estimates are sample
              content.
            </p>
          </div>
        </Modal>
      )}
      {modal === "location" && (
        <Modal title="Where’s your happy place?" close={() => setModal(null)}>
          <p>
            Set a delivery label for this demo. No location data is sent to a
            delivery service.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              localStorage.setItem(
                "bite.address",
                JSON.stringify(address.trim() || "Connaught Place, New Delhi"),
              );
              setAddress(address.trim() || "Connaught Place, New Delhi");
              setModal(null);
            }}
          >
            <label className="field-label">
              Delivery location
              <input
                autoFocus
                maxLength={100}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
              />
            </label>
            <button className="primary modal-action">Save location</button>
          </form>
        </Modal>
      )}
      {modal === "checkout" && (
        <Modal
          title={order ? "You’ve got good taste." : "One last look."}
          close={() => setModal(null)}
        >
          {order ? (
            <div className="order-success">
              <CheckCircle2 size={62} />
              <h3>Demo order confirmed!</h3>
              <p>{order.id}</p>
              <p>Total: {money(order.total)}</p>
              <div className="info-callout">
                No payment was taken. No restaurant was contacted. Your order
                was saved locally.
              </div>
              <button
                className="primary modal-action"
                onClick={() => setModal(null)}
              >
                Back to the menu
              </button>
            </div>
          ) : (
            <>
              <p>
                Delivery label: <strong>{address}</strong>
              </p>
              {cartItems.map((x) => (
                <div className="checkout-line" key={x.id}>
                  <span>
                    {validCart[x.id]} × {x.name}
                  </span>
                  <strong>{money(x.price * validCart[x.id])}</strong>
                </div>
              ))}
              <div className="checkout-line">
                <span>Delivery</span>
                <span>{delivery ? money(delivery) : "Free"}</span>
              </div>
              <div className="checkout-line bill-total">
                <strong>Total</strong>
                <strong>{money(subtotal + delivery)}</strong>
              </div>
              <div className="info-callout">
                This is a local demonstration. Placing this order does not
                charge you or contact a restaurant.
              </div>
              {error && (
                <p role="alert" className="checkout-error">
                  {error}
                </p>
              )}
              <button
                disabled={busy || !count}
                className="primary modal-action"
                onClick={() => void placeOrder()}
              >
                {busy ? "Saving your order…" : "Place demo order"}
                <Check size={18} />
              </button>
            </>
          )}
        </Modal>
      )}
      {modal === "activity" && (
        <Modal title="The kitchen’s activity." close={() => setModal(null)}>
          <p>
            Actual events saved by this local server. Comparison previews are
            labelled separately.
          </p>
          <div className="info-callout">
            <strong>Flagsmith</strong>
            <p>{activity?.flagsmith || "Loading…"}</p>
          </div>
          <div className="activity-stats">
            {activity?.sessions?.map((s: any, i: number) => (
              <div key={i}>
                <strong>{s.visits}</strong>
                <span>
                  {s.version} {s.preview ? "preview" : "visits"}
                </span>
              </div>
            ))}
          </div>
          <div className="activity-feed">
            {activity?.recent?.map((e: any, i: number) => (
              <div key={i}>
                <span>
                  <Activity size={13} />
                  {e.name.replaceAll("_", " ")}
                </span>
                <small>
                  {e.version}
                  {e.preview ? " · preview" : ""}
                </small>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
function Quantity({
  item,
  quantity,
  onAdd,
  onRemove,
}: {
  item: Item;
  quantity: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="quantity">
      <button aria-label={`Remove one ${item.name}`} onClick={onRemove}>
        <Minus size={14} />
      </button>
      <span aria-live="polite">{quantity}</span>
      <button
        aria-label={`Add one ${item.name}`}
        disabled={quantity >= 20}
        onClick={onAdd}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-inner">
        <div className="modal-heading">
          <h2>{title}</h2>
          <button aria-label="Close dialog" onClick={close}>
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
