export const categories = [
  "All",
  "Burgers",
  "Pizza",
  "Bowls",
  "Indian",
  "Sides",
  "Drinks",
] as const;
export const menu = [
  {
    id: "smash",
    name: "The OG Smash",
    category: "Burgers",
    price: 249,
    description:
      "Double smashed patty, molten cheddar, house sauce and pickles in a toasted potato bun.",
    image: "/food/burger.jpg",
    tag: "Bestseller",
    rating: 4.9,
    calories: 620,
    veg: false,
  },
  {
    id: "margherita",
    name: "Margherita, made right",
    category: "Pizza",
    price: 329,
    description:
      "Slow-fermented dough, San Marzano tomatoes, fresh mozzarella and fragrant basil.",
    image: "/food/pizza.jpg",
    tag: "Crowd favourite",
    rating: 4.8,
    calories: 740,
    veg: true,
  },
  {
    id: "harvest",
    name: "The feel-good bowl",
    category: "Bowls",
    price: 289,
    description:
      "Roasted seasonal vegetables, quinoa, crisp greens and our lemon-tahini dressing.",
    image: "/food/bowl.jpg",
    tag: "Fresh pick",
    rating: 4.7,
    calories: 420,
    veg: true,
  },
  {
    id: "paneer",
    name: "Butter paneer bowl",
    category: "Indian",
    price: 279,
    description:
      "Soft paneer in a rich tomato-butter gravy, served with fragrant basmati rice.",
    image: "/food/indian.jpg",
    tag: "Comfort food",
    rating: 4.8,
    calories: 580,
    veg: true,
  },
  {
    id: "fries",
    name: "Not-your-basic fries",
    category: "Sides",
    price: 139,
    description:
      "Golden, skin-on fries tossed in our signature seasoning, with a smoky dip.",
    image: "/food/fries.jpg",
    tag: "Perfect on the side",
    rating: 4.8,
    calories: 310,
    veg: true,
  },
  {
    id: "lemonade",
    name: "A little sunshine",
    category: "Drinks",
    price: 99,
    description:
      "Freshly squeezed lemonade with mint, a little fizz and a whole lot of refreshment.",
    image: "/food/drink.jpg",
    tag: "Made fresh",
    rating: 4.6,
    calories: 90,
    veg: true,
  },
];
export type MenuItem = (typeof menu)[number];
export function priceCart(cart: Record<string, number>) {
  const entries = Object.entries(cart);
  if (!entries.length || entries.length > menu.length)
    throw new Error("Your cart is empty or invalid.");
  let subtotal = 0;
  for (const [id, quantity] of entries) {
    const item = menu.find((x) => x.id === id);
    if (!item || !Number.isInteger(quantity) || quantity < 1 || quantity > 20)
      throw new Error("Invalid cart quantity or item.");
    subtotal += item.price * quantity;
  }
  const delivery = subtotal >= 499 ? 0 : 29;
  return { subtotal, delivery, total: subtotal + delivery };
}
