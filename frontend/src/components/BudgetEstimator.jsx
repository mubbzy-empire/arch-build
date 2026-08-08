import React, { useState } from 'react';
import { getCostEstimate } from '../api/client';

function formatMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return `$${Math.round(n).toLocaleString()}`;
}

export default function BudgetEstimator({ project }) {
  const [budget, setBudget] = useState('');
  const [loading, setLoading] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [error, setError] = useState(null);

  const runEstimate = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getCostEstimate(project, budget ? Number(budget) : null);
      setEstimate(result);
    } catch (err) {
      setError(err.message || 'Could not get an estimate.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel bracket">
      <div className="section-head"><h3>Budget &amp; cost estimate</h3></div>
      <p className="page-sub" style={{ marginBottom: 12 }}>
        Enter your budget for a direct comparison, or leave it blank for a general range.
      </p>
      <div className="budget-input-row">
        <input
          type="number"
          inputMode="numeric"
          placeholder="Your budget (USD, optional)"
          value={budget}
          onChange={e => setBudget(e.target.value)}
        />
        <button className="btn btn-primary" onClick={runEstimate} disabled={loading}>
          {loading ? 'Estimating…' : estimate ? 'Re-estimate' : 'Get estimate'}
        </button>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{error}</p>}

      {estimate && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
            <span className={`grounded-tag ${estimate.grounded ? 'live' : ''}`}>
              {estimate.grounded ? 'Search-informed estimate' : estimate.engine === 'offline' ? 'Offline formula' : 'AI reasoning estimate'}
            </span>
          </div>
          <div className="estimate-grid">
            <div className="estimate-stat">
              <div className="label">Materials</div>
              <div className="value">{formatMoney(estimate.materialsLow)}–{formatMoney(estimate.materialsHigh)}</div>
            </div>
            <div className="estimate-stat">
              <div className="label">Labor</div>
              <div className="value">{formatMoney(estimate.laborLow)}–{formatMoney(estimate.laborHigh)}</div>
            </div>
            <div className="estimate-stat" style={{ gridColumn: '1 / -1' }}>
              <div className="label">Estimated timeline</div>
              <div className="value">{estimate.timeline || '—'}</div>
            </div>
          </div>
          {estimate.budgetNote && <p className="page-sub" style={{ marginTop: 12 }}>{estimate.budgetNote}</p>}
          {estimate.notes && <p className="page-sub" style={{ marginTop: 6, fontSize: 12 }}>{estimate.notes}</p>}
          <p className="page-sub" style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-faint)' }}>
            Rough AI-generated approximation for early planning — always confirm with local contractor quotes before committing to a budget.
          </p>
        </div>
      )}
    </div>
  );
}
