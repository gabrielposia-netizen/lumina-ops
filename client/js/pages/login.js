import { api, setToken } from '../api.js';
import { esc } from '../ui.js';

const ACCOUNTS = [
  ['Administrador', 'admin@lumina.local', 'admin123'],
  ['Gestor', 'gestor@lumina.local', 'gestor123'],
  ['Estoque', 'estoque@lumina.local', 'estoque123'],
  ['Produção', 'producao@lumina.local', 'producao123'],
  ['Expedição', 'expedicao@lumina.local', 'expedicao123'],
  ['Consulta', 'consulta@lumina.local', 'consulta123'],
];

export async function renderLogin() {
  return {
    html: `<div class="login-page">
      <div class="login-card">
      <section class="login-hero">
        <div class="mark">L</div>
        <div>
          <p class="kicker">Operação de e-commerce</p>
          <h1>Do recebimento à expedição, em um só movimento.</h1>
          <p>Estoque, kits, embalagens, produção, etiquetas e o Gestor IA no mesmo livro de movimentações.</p>
          <div class="steps"><span>Recebimento</span><span>Estoque</span><span>Montagem</span><span>Etiqueta</span><span>Expedição</span><span>IA</span></div>
        </div>
      </section>
      <form class="login-form" id="login-form">
          <p class="kicker">Acesso</p>
          <h1>Entrar</h1>
          <p class="lede">Use um perfil de demonstração ou a conta da operação.</p>
          <div id="login-error"></div>
          <div class="form-grid" style="grid-template-columns:1fr;margin-top:16px">
            <label class="field"><span>E-mail</span><input name="email" type="email" autocomplete="username" required value="admin@lumina.local"></label>
            <label class="field"><span>Senha</span><input name="password" type="password" autocomplete="current-password" required value="admin123"></label>
          </div>
          <button class="btn btn-primary" style="width:100%;margin-top:14px" type="submit">Acessar a operação</button>
          <p class="help" style="margin-top:18px">Acessos de demonstração</p>
          <div class="accounts">${ACCOUNTS.map(([label, email]) => `<button class="btn btn-sm" type="button" data-email="${esc(email)}" data-password="${esc(ACCOUNTS.find((item) => item[1] === email)[2])}">${esc(label)}</button>`).join('')}</div>
      </form>
      </div>
    </div>`,
    bind(root) {
      const form = root.querySelector('#login-form');
      root.querySelectorAll('[data-email]').forEach((button) => {
        button.onclick = () => {
          form.email.value = button.dataset.email;
          form.password.value = button.dataset.password;
        };
      });
      form.onsubmit = async (event) => {
        event.preventDefault();
        const error = root.querySelector('#login-error');
        error.innerHTML = '';
        try {
          const result = await api('/api/auth/login', { method: 'POST', body: { email: form.email.value, password: form.password.value } });
          setToken(result.token);
          location.hash = '#/';
        } catch (err) {
          error.innerHTML = `<div class="banner banner-danger">${esc(err.message)}</div>`;
        }
      };
    },
  };
}
