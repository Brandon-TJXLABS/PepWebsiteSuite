// Loads lab results from Supabase and renders them into the results table
// on lab-results.html

function acionaFormatDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

async function acionaLoadLabResults() {
  const tbody = document.getElementById('lab-results-body');
  if (!tbody) return;

  const { data, error } = await supabaseClient
    .from('lab_results')
    .select('*')
    .order('test_date', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--ink-soft);">Could not load lab results right now.</td></tr>`;
    console.error(error);
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--ink-soft);">No lab results published yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(r => `
    <tr>
      <td>${r.product_name}</td>
      <td class="mono">${r.batch_code}</td>
      <td class="mono">${acionaFormatDate(r.test_date)}</td>
      <td class="mono">${r.purity || '—'}</td>
      <td class="mono">${r.endotoxin || '—'}</td>
      <td><span class="pass">${r.result}</span></td>
      <td>${r.pdf_url
        ? `<a href="${r.pdf_url}" target="_blank" rel="noopener">Download PDF</a>`
        : `<span style="color:var(--ink-soft); font-size:.85rem;">Not yet available</span>`}
      </td>
    </tr>
  `).join('');
}

document.addEventListener('DOMContentLoaded', acionaLoadLabResults);
