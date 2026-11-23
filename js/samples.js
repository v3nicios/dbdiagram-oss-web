(function (global) {
  'use strict';

  const DBStudio = (global.DBStudio = global.DBStudio || {});

  const SAMPLES = {
    ecommerce: {
      name: 'E-commerce Completo',
      dbml: `// E-commerce Database Schema (DBML)
// Dica: Use o controle "Fonte do Diagrama" no topo e exporte em SVG, PNG ou PDF!

Project ecommerce_oss {
  database_type: 'PostgreSQL'
  Note: 'Esquema de E-commerce com usuários, catálogo, pedidos e pagamentos'
}

Enum order_status {
  pending [note: 'Aguardando confirmação']
  paid
  shipped
  delivered
  cancelled
}

Enum payment_method {
  credit_card
  pix
  boleto
}

TableGroup clientes_e_acesso [color: #3b82f6] {
  users
  addresses
}

TableGroup catalogo [color: #10b981] {
  categories
  products
}

TableGroup vendas [color: #f59e0b] {
  orders
  order_items
  payments
}

Table users [headercolor: #2563eb] {
  id integer [pk, increment]
  name varchar(120) [not null]
  email varchar(180) [unique, not null, note: 'Login principal do cliente']
  role varchar(30) [default: 'customer']
  created_at timestamp [default: \`now()\`]

  Note: 'Contas de clientes e administradores'
}

Table addresses [headercolor: #1d4ed8] {
  id integer [pk, increment]
  user_id integer [not null, ref: > users.id]
  street varchar(200) [not null]
  city varchar(100) [not null]
  zip_code varchar(20) [not null]
  is_default boolean [default: false]
}

Table categories [headercolor: #059669] {
  id integer [pk, increment]
  parent_id integer [ref: > categories.id]
  name varchar(100) [not null]
  slug varchar(120) [unique, not null]
}

Table products [headercolor: #10b981] {
  id integer [pk, increment]
  category_id integer [not null, ref: > categories.id]
  sku varchar(40) [unique, not null]
  name varchar(180) [not null]
  price decimal(10, 2) [not null]
  stock integer [default: 0]
  active boolean [default: true]
}

Table orders [headercolor: #d97706] {
  id integer [pk, increment]
  user_id integer [not null]
  address_id integer [not null]
  status order_status [default: 'pending']
  total_amount decimal(12, 2) [not null]
  created_at timestamp [default: \`now()\`]
}

Table order_items [headercolor: #ea580c] {
  id integer [pk, increment]
  order_id integer [not null]
  product_id integer [not null]
  quantity integer [not null]
  unit_price decimal(10, 2) [not null]

  Indexes {
    (order_id, product_id) [unique]
  }
}

Table payments [headercolor: #7c3aed] {
  id integer [pk, increment]
  order_id integer [unique, not null]
  method payment_method [not null]
  amount decimal(12, 2) [not null]
  paid_at timestamp
}

Ref: orders.user_id > users.id [delete: restrict]
Ref: orders.address_id > addresses.id
Ref: order_items.order_id > orders.id [delete: cascade]
Ref: order_items.product_id > products.id
Ref: payments.order_id - orders.id`
    },

    saas: {
      name: 'SaaS Multi-tenant',
      dbml: `Project saas_platform {
  database_type: 'PostgreSQL'
}

Enum plan_tier {
  free
  pro
  enterprise
}

Enum member_role {
  owner
  admin
  member
}

TableGroup tenant_core [color: #6366f1] {
  organizations
  memberships
  users
}

TableGroup billing [color: #14b8a6] {
  subscriptions
  invoices
}

Table organizations [headercolor: #4f46e5] {
  id uuid [pk]
  name varchar(150) [not null]
  slug varchar(80) [unique, not null]
  plan plan_tier [default: 'free']
  created_at timestamp [default: \`now()\`]
}

Table users [headercolor: #2563eb] {
  id uuid [pk]
  email varchar(180) [unique, not null]
  full_name varchar(120) [not null]
  is_active boolean [default: true]
}

Table memberships [headercolor: #7c3aed] {
  id uuid [pk]
  organization_id uuid [not null, ref: > organizations.id]
  user_id uuid [not null, ref: > users.id]
  role member_role [default: 'member']
  joined_at timestamp [default: \`now()\`]
}

Table projects [headercolor: #ec4899] {
  id uuid [pk]
  organization_id uuid [not null, ref: > organizations.id]
  name varchar(140) [not null]
  api_key varchar(64) [unique, not null]
  updated_at timestamp
}

Table subscriptions [headercolor: #0d9488] {
  id uuid [pk]
  organization_id uuid [unique, not null, ref: - organizations.id]
  plan plan_tier [not null]
  seats integer [default: 5]
  renews_at timestamp [not null]
}

Table invoices [headercolor: #0f766e] {
  id uuid [pk]
  subscription_id uuid [not null, ref: > subscriptions.id]
  amount_cents integer [not null]
  paid boolean [default: false]
  issued_at timestamp [default: \`now()\`]
}`
    },

    blog: {
      name: 'Blog & Comunidade',
      dbml: `Project blog_community {
  database_type: 'PostgreSQL'
}

Enum post_status {
  draft
  published
  archived
}

Table authors [headercolor: #0284c7] {
  id integer [pk, increment]
  username varchar(50) [unique, not null]
  display_name varchar(100) [not null]
  bio text
}

Table posts [headercolor: #2563eb] {
  id integer [pk, increment]
  author_id integer [not null, ref: > authors.id]
  title varchar(200) [not null]
  slug varchar(220) [unique, not null]
  body text [not null]
  status post_status [default: 'draft']
  published_at timestamp
}

Table tags [headercolor: #059669] {
  id integer [pk, increment]
  name varchar(60) [unique, not null]
}

Table post_tags [headercolor: #10b981] {
  post_id integer [pk, ref: > posts.id]
  tag_id integer [pk, ref: > tags.id]
}

Table comments [headercolor: #d97706] {
  id integer [pk, increment]
  post_id integer [not null, ref: > posts.id]
  author_id integer [not null, ref: > authors.id]
  parent_comment_id integer [ref: > comments.id]
  content text [not null]
  created_at timestamp [default: \`now()\`]
}`
    }
  };

  DBStudio.samples = SAMPLES;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DBStudio.samples;
  }
})(typeof window !== 'undefined' ? window : globalThis);
