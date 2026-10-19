'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, money, type Pagination, type Product } from '@/lib/api';
import { useApp } from '@/lib/store';

export default function CatalogPage() {
  const { addToCart } = useApp();
  const [products, setProducts] = useState<Product[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [added, setAdded] = useState('');

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), limit: '12', sort });
    if (search) qs.set('search', search);
    if (category) qs.set('category', category);
    try {
      const res = await api<{ data: { products: Product[]; pagination: Pagination } }>(`/api/products?${qs}`);
      setProducts(res.data.products);
      setPagination(res.data.pagination);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [page, sort, search, category]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api<{ data: string[] }>('/api/products/categories').then((r) => setCategories(r.data)).catch(() => undefined);
  }, []);

  return (
    <>
      <h1>Catalog</h1>
      <form
        className="row"
        style={{ marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          void load();
        }}
      >
        <input aria-label="Search products" placeholder="Search products" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
          <option value="name">Name</option>
        </select>
        <button type="submit">Search</button>
      </form>
      {error && <p className="error">{error}</p>}
      {added && <p className="success">Added {added} to cart</p>}
      {products.length === 0 && !error && <p className="muted">No products found.</p>}
      <div className="grid">
        {products.map((p) => (
          <div className="card" key={p.id} data-testid="product-card">
            <div className="muted">{p.category}</div>
            <h3 style={{ margin: '4px 0' }}>{p.name}</h3>
            <p className="muted">{p.description}</p>
            <div className="row spread">
              <span className="price">{money(p.price)}</span>
              <span className="muted">{p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'}</span>
            </div>
            <button
              style={{ marginTop: 10, width: '100%' }}
              disabled={p.stock === 0}
              onClick={() => {
                addToCart(p);
                setAdded(p.name);
              }}
            >
              Add to cart
            </button>
          </div>
        ))}
      </div>
      {pagination && pagination.pages > 1 && (
        <div className="row" style={{ marginTop: 16 }}>
          <button className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="muted">Page {pagination.page} of {pagination.pages}</span>
          <button className="secondary" disabled={page >= pagination.pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </>
  );
}
