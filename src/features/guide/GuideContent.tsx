import type { ReactNode } from 'react';
import { SECTIONS, type SectionId } from './guide';
import styles from './Guide.module.css';

/** The guide itself: a table of contents and the sections. Used signed in and out. */
export function GuideContent() {
  return (
    <div className={styles.guide}>
      <nav className={styles.toc} aria-label="Contents">
        <p className={styles.tocTitle}>Contents</p>
        <ol>
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.title}</a>
            </li>
          ))}
        </ol>
      </nav>
      <div className={styles.body}>
        {SECTIONS.map((section) => (
          <section key={section.id} id={section.id} className={styles.section} aria-labelledby={`${section.id}-title`}>
            <h2 id={`${section.id}-title`}>{section.title}</h2>
            {BODIES[section.id]}
          </section>
        ))}
      </div>
    </div>
  );
}

const Coming = () => <span className={styles.coming}>coming</span>;

function Steps({ children }: { children: ReactNode }) {
  return <ol className={styles.steps}>{children}</ol>;
}

/** Phones and laptops on each node's Wi-Fi, nodes talking to each other over the radio. */
function MeshDiagram() {
  return (
    <figure className={styles.figure}>
      <svg viewBox="0 0 560 170" role="img" aria-labelledby="mesh-diagram-title">
        <title id="mesh-diagram-title">Two Kaonic nodes linked by radio, each with phones on its Wi-Fi</title>
        <g className={styles.client}>
          <rect x="16" y="20" width="40" height="64" rx="8" />
          <rect x="16" y="96" width="40" height="64" rx="8" />
          <rect x="504" y="58" width="40" height="64" rx="8" />
        </g>
        <g className={styles.wifi}>
          <line x1="58" y1="52" x2="150" y2="84" />
          <line x1="58" y1="128" x2="150" y2="96" />
          <line x1="502" y1="90" x2="410" y2="90" />
        </g>
        <text className={styles.caption} x="92" y="60" textAnchor="middle">Wi-Fi / USB</text>
        <text className={styles.caption} x="456" y="80" textAnchor="middle">Wi-Fi</text>
        <g className={styles.node}>
          <rect x="150" y="60" width="96" height="60" rx="10" />
          <rect x="314" y="60" width="96" height="60" rx="10" />
        </g>
        <text className={styles.nodeText} x="198" y="95" textAnchor="middle">Kaonic</text>
        <text className={styles.nodeText} x="362" y="95" textAnchor="middle">Kaonic</text>
        <path className={styles.radio} d="M252 90 C 270 70, 296 70, 308 90" />
        <path className={styles.radio} d="M252 90 C 270 110, 296 110, 308 90" />
        <text className={styles.caption} x="280" y="56" textAnchor="middle">radio mesh</text>
      </svg>
      <figcaption>Phones and laptops join a node's Wi-Fi (or USB). Nodes reach each other over the radio, through other nodes when they are out of range.</figcaption>
    </figure>
  );
}

/** The four provisioning messages between the admin device and a new node. */
function PairingDiagram() {
  const rows: Array<[string, 'right' | 'left', string]> = [
    ['1', 'right', 'Request: the admin’s root certificate'],
    ['2', 'left', 'Certificate request, bound to this link'],
    ['3', 'right', 'Node certificate, allowlist, voice key'],
    ['4', 'left', 'Result: provisioned'],
  ];
  return (
    <figure className={styles.figure}>
      <svg viewBox="0 0 560 250" role="img" aria-labelledby="pairing-diagram-title">
        <title id="pairing-diagram-title">Provisioning: four messages between the admin device and the new node over one link</title>
        <defs>
          <marker id="guide-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className={styles.arrowHead} />
          </marker>
        </defs>
        <g className={styles.node}>
          <rect x="20" y="10" width="140" height="40" rx="8" />
          <rect x="400" y="10" width="140" height="40" rx="8" />
        </g>
        <text className={styles.adminText} x="90" y="35" textAnchor="middle">Kaonic Admin</text>
        <text className={styles.nodeText} x="470" y="35" textAnchor="middle">New node</text>
        <line className={styles.lane} x1="90" y1="50" x2="90" y2="240" />
        <line className={styles.lane} x1="470" y1="50" x2="470" y2="240" />
        {rows.map(([number, way, text], index) => {
          const y = 82 + index * 44;
          return (
            <g key={number}>
              <line
                className={styles.message}
                x1={way === 'right' ? 96 : 464}
                y1={y}
                x2={way === 'right' ? 464 : 96}
                y2={y}
                markerEnd="url(#guide-arrow)"
              />
              <text className={styles.caption} x="280" y={y - 7} textAnchor="middle">
                {number}. {text}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>All four messages travel over one encrypted radio link the admin opens to the node. The node’s request names that link, so it cannot be replayed on another one.</figcaption>
    </figure>
  );
}

const BODIES: Record<SectionId, ReactNode> = {
  node: (
    <>
      <p>
        A Kaonic node is a small radio computer. Nodes talk to each other over a long-range radio and form a <strong>mesh</strong>: a message for a node out of range is
        passed on by the nodes in between.
      </p>
      <MeshDiagram />
      <ul>
        <li>
          <strong>Wi-Fi hotspot and USB.</strong> Your phone or laptop connects to a node’s own Wi-Fi or by USB cable. This web page is served by the node itself; it works
          without internet.
        </li>
        <li>
          <strong>One network, one admin.</strong> Every network has exactly one <em>Kaonic Admin</em> device. It decides which nodes belong to the network.
        </li>
        <li>
          <strong>What it carries:</strong> push-to-talk voice to every node, a VPN between nodes (and the phones behind them), and the status of the radio and the mesh.
        </li>
      </ul>
    </>
  ),

  'first-start': (
    <>
      <Steps>
        <li>
          <strong>Connect.</strong> Join the node’s Wi-Fi hotspot (its name starts with “Kaonic”), or plug in the USB cable.
        </li>
        <li>
          <strong>Open the page.</strong> Go to <span className="mono">https://192.168.10.1</span>.
        </li>
        <li>
          <strong>Accept the certificate.</strong> Each node signs its own web certificate, so the browser warns the first time. Choose to continue. To stop the warning, download
          the node’s certificate authority from <a href="/api/v1/device/rootca">/api/v1/device/rootca</a> and install it as trusted on your phone or laptop.
        </li>
        <li>
          <strong>Set it up.</strong> A new node asks how it will be used:
          <ul>
            <li>
              <strong>Kaonic Admin</strong> — for the one device that runs the network. The device makes a <em>seed phrase</em> of 12 or 24 words. The admin’s identity is
              made from it, so the same words recreate the same admin on a replacement device. Write them down or save them, and keep them private; anyone who has them can
              become your admin.
            </li>
            <li>
              <strong>Member</strong> — for every other node. It then waits for the admin to take it into the network.
            </li>
          </ul>
        </li>
        <li>
          <strong>Sign in</strong> with the password you chose. The admin device shows an <span className={styles.adminTag}>ADMIN</span> tag next to the Kaonic logo.
        </li>
      </Steps>
    </>
  ),

  pairing: (
    <>
      <p>
        The admin is the network’s root of trust. Pairing — also called provisioning — is how the admin takes a new node into its network. It happens over the radio, so the
        node only needs to be in range (directly or through other nodes).
      </p>
      <Steps>
        <li>A new member node announces itself on the radio as <em>waiting to join</em>.</li>
        <li>
          On the admin device, open <strong>Mesh</strong> (tap the node) or <strong>Nodes</strong> (the “New” group) and choose <strong>Set up and whitelist</strong>.
        </li>
        <li>The admin opens an encrypted link to the node and the four messages below go back and forth. This takes a few seconds; the node shows progress while it runs.</li>
        <li>
          The node stores its certificate, the <em>allowlist</em> (the admin-signed list of nodes in the network) and the push-to-talk voice key. From now on it belongs to this
          admin.
        </li>
      </Steps>
      <PairingDiagram />
      <ul>
        <li>
          <strong>First admin wins.</strong> A node that already belongs to another admin refuses. It must be <strong>factory reset</strong> before a new admin can take it.
        </li>
        <li>
          <strong>Who can pair.</strong> Until a node is paired, any admin in radio range can take it. Pair new nodes soon after setting them up.
        </li>
      </ul>
      <h3>What the network labels mean</h3>
      <dl className={styles.terms}>
        <dt>Unprovisioned</dt>
        <dd>Set up as a member, waiting for an admin to take it.</dd>
        <dt>Ours</dt>
        <dd>Paired by our admin. Whitelisted nodes are trusted; the purple node is the Kaonic Admin itself.</dd>
        <dt>Other</dt>
        <dd>Paired by a different admin. It is not trusted and cannot be whitelisted until it is factory reset.</dd>
      </dl>
    </>
  ),

  trust: (
    <>
      <ul>
        <li>
          <strong>Every link is checked.</strong> When two nodes of the network link up, each proves its certificate to the other (AUTH) before anything else crosses. A node
          that is not on the allowlist, or holds a certificate from another admin, is refused.
        </li>
        <li>
          <strong>The allowlist spreads.</strong> Nodes pass the newest allowlist to each other, so a node paired later becomes known to everyone without visiting each node.
        </li>
        <li>
          <strong>Removing a node.</strong> Taking a node off the whitelist on the admin device revokes it: the new allowlist reaches every node within seconds, links to it are
          closed, and the push-to-talk voice key is changed so it can no longer listen or talk.
        </li>
        <li>
          <strong>The admin stays trusted.</strong> The Kaonic Admin of a network can’t be removed or blacklisted.
        </li>
      </ul>
    </>
  ),

  using: (
    <>
      <dl className={styles.terms}>
        <dt>Mesh</dt>
        <dd>
          A live map: this device in the centre, other nodes on rings by how many hops away they are. Green nodes are trusted, yellow ones are waiting to join, the purple one is
          the Kaonic Admin, faded ones are out of range. Moving dots show traffic as it passes. Tap a node for details and actions.
        </dd>
        <dt>Nodes</dt>
        <dd>Every node this device has heard, grouped as new, whitelisted and blacklisted. Pair, remove and inspect nodes here.</dd>
        <dt>Talk</dt>
        <dd>
          Push-to-talk to every node at once: hold the button or the space bar. A node’s hardware PTT button works through its microphone: the button unmutes the mic and the
          squelch keys the radio when it hears you. You can also talk with your browser’s microphone. The admin’s voice has priority and takes the channel from anyone talking.
          Only one person talks at a time.
        </dd>
        <dt>VPN</dt>
        <dd>
          Every node gets a tunnel address (10.77.x.x) and can reach the others over the radio, and nodes can share the network their phones are on. The VPN page shows the
          nodes, routes (including refused ones and why) and a live view of the packets crossing the tunnel.
        </dd>
        <dt>Radio</dt>
        <dd>
          Frequency, channel, modulation and power of each radio band, with live traffic. Nodes only hear each other when their settings match: changing the mesh band on one node
          cuts it off from the rest. Applying a change to all nodes at once is <Coming />.
        </dd>
        <dt>Network</dt>
        <dd>The node’s Wi-Fi: its own hotspot, joining other Wi-Fi networks, the order it tries them in and whether it connects automatically.</dd>
        <dt>Traffic</dt>
        <dd>How much the radio and the VPN carry, a frame-by-frame view of what is on the air, and who is talking.</dd>
        <dt>System</dt>
        <dd>
          Device details, health, services, reboot and factory reset. Updating the hub and plugins, uploading a kernel and choosing the boot slot are <Coming />.
        </dd>
      </dl>
    </>
  ),

  troubleshooting: (
    <>
      <dl className={styles.terms}>
        <dt>A node is not on the map</dt>
        <dd>
          Check it is switched on and in range, and that its radio settings match (Radio page). Nodes announce themselves regularly; a node just switched on can take up to a
          minute to appear.
        </dd>
        <dt>A node can’t join</dt>
        <dd>
          If it shows as “Other”, it belongs to another admin: factory reset it, set it up as a member, then pair it again. If pairing stops partway, try again — the radio may
          have lost a message.
        </dd>
        <dt>Links don’t come up</dt>
        <dd>Both nodes must be paired by the same admin and on its allowlist. A node removed from the whitelist is refused until it is added again.</dd>
        <dt>No sound on Talk</dt>
        <dd>
          The Talk page says why: no voice codec on the device, no microphone or speaker, or the device not paired yet. Without a working microphone on the device, switch the
          talk input to your browser’s microphone.
        </dd>
        <dt>The VPN doesn’t reach a node</dt>
        <dd>
          Check the node is linked (Nodes or VPN page) and the route is not refused. Routes that overlap another node’s network or this node’s own are refused on purpose.
        </dd>
        <dt>Forgotten password</dt>
        <dd>
          The login password can’t be recovered: factory reset the device and set it up again. On the admin device, setting it up again with the same <em>seed phrase</em>
          recreates the same admin, so the network keeps trusting it. If the phrase is lost too, every node has to be factory reset and paired with a new admin.
        </dd>
      </dl>
    </>
  ),
};
