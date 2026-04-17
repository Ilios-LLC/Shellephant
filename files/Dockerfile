FROM node:24

ARG TZ
ENV TZ="$TZ"

ARG CLAUDE_CODE_VERSION=latest

# Install basic development tools and iptables/ipset
RUN apt-get update && apt-get install -y --no-install-recommends \
  less \
  git \
  procps \
  sudo \
  fzf \
  zsh \
  man-db \
  unzip \
  gnupg2 \
  gh \
  iptables \
  ipset \
  iproute2 \
  dnsutils \
  aggregate \
  jq \
  nano \
  vim \
  tmux \
  python3.11-venv \
  python3.11-dev \
  python3-pip \
  build-essential \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install uvicorn
RUN pip3 install --break-system-packages uvicorn

# Install Go
ARG GO_VERSION=1.24.2
RUN ARCH=$(dpkg --print-architecture) && \
  wget -q "https://go.dev/dl/go${GO_VERSION}.linux-${ARCH}.tar.gz" && \
  tar -C /usr/local -xzf "go${GO_VERSION}.linux-${ARCH}.tar.gz" && \
  rm "go${GO_VERSION}.linux-${ARCH}.tar.gz"
ENV PATH=$PATH:/usr/local/go/bin:/home/node/go/bin

# Install air (Go hot reload)
RUN GOBIN=/usr/local/bin go install github.com/air-verse/air@latest

# Ensure default node user has access to /usr/local/share
RUN mkdir -p /usr/local/share/npm-global && \
  chown -R node:node /usr/local/share

ARG USERNAME=node

# Persist bash history.
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  && mkdir /commandhistory \
  && touch /commandhistory/.bash_history \
  && chown -R $USERNAME /commandhistory

# Set `DEVCONTAINER` environment variable to help with orientation
ENV DEVCONTAINER=true

# Create workspace and config directories and set permissions
RUN mkdir -p /workspace /home/node/.claude && \
  chown -R node:node /workspace /home/node/.claude

WORKDIR /workspace

ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \
  wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  sudo dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
  rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# Install Playwright system dependencies for Chromium (needs root for apt)
RUN npx -y playwright-core install-deps chromium && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Set up non-root user
USER node

# Install global packages
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Set the default shell to zsh rather than sh
ENV SHELL=/bin/zsh

# Set the default editor and visual
ENV EDITOR=nano
ENV VISUAL=nano

# Default powerline10k theme
ARG ZSH_IN_DOCKER_VERSION=1.2.0
RUN sh -c "$(wget -O- https://github.com/deluan/zsh-in-docker/releases/download/v${ZSH_IN_DOCKER_VERSION}/zsh-in-docker.sh)" -- \
  -p git \
  -p fzf \
  -a "source /usr/share/doc/fzf/examples/key-bindings.zsh" \
  -a "source /usr/share/doc/fzf/examples/completion.zsh" \
  -a "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
  -x

# Configure SSH for GitHub
RUN mkdir -p /home/node/.ssh && \
  chmod 700 /home/node/.ssh && \
  printf 'Host github.com\n  HostName github.com\n  User git\n  IdentityFile /home/node/.ssh/github\n  StrictHostKeyChecking no\n' > /home/node/.ssh/config && \
  chmod 600 /home/node/.ssh/config

# Install Claude
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH=$PATH:/home/node/.local/bin

# Install Playwright MCP server and download Chromium for headless browsing
ENV PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright
RUN npm install -g @playwright/mcp@latest && \
    npx -y playwright-core install --no-shell chromium

# Configure Playwright defaults for Docker (headless, no sandbox, chromium-only)
ENV PLAYWRIGHT_MCP_HEADLESS=true
ENV PLAYWRIGHT_MCP_NO_SANDBOX=true
ENV PLAYWRIGHT_MCP_BROWSER=chromium

# Enable experimental agent teams feature in Claude Code
ENV CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
ENV CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1

# Copy and set up firewall script
COPY init-firewall.sh /usr/local/bin/
COPY CLAUDE.md /home/node/.claude/

# tmux config: no status bar, truecolor
COPY --chown=node:node tmux.conf /home/node/.tmux.conf

# Pre-seed Claude Code config so first run skips onboarding and has plugins pre-enabled.
COPY --chown=node:node claude-settings.json /home/node/.claude/settings.json
COPY --chown=node:node claude-dot-json.json /home/node/.claude.json

# Install plugins at build time so first run is instant. These commands are file-system-only
# (git clone marketplace + copy plugin files); no API key auth required.
RUN claude plugin marketplace add JuliusBrussee/caveman && \
    claude plugin install caveman@caveman && \
    claude plugin marketplace add obra/superpowers-marketplace && \
    claude plugin install superpowers@superpowers-marketplace

USER root
COPY claude-summarize.sh /usr/local/bin/claude-summarize.sh
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/init-firewall.sh /usr/local/bin/docker-entrypoint.sh /usr/local/bin/claude-summarize.sh && \
  echo "node ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/node-firewall && \
  chmod 0440 /etc/sudoers.d/node-firewall
USER node

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["sleep", "infinity"]
