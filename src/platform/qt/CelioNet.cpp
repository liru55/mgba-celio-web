/* Net link over the public Celio relay, built into the Qt frontend (Windows only).
 * See CelioNet.h.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#include "CelioNet.h"

#include "CoreController.h"

#include <mgba/core/core.h>
#include <mgba/core/interface.h>
#include <mgba/internal/gba/gba.h>
#include <mgba/internal/gba/io.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <random>

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winhttp.h>

using namespace QGBA;

namespace {

// celio_device.lua
enum LinkStatus : uint16_t {
	AwaitModeEmulator = 0xFF01,
	AwaitMode = 0xFF02,
	HandshakeReceived = 0xFF03,
	HandshakeFinished = 0xFF04,
	LinkConnected = 0xFF05,
	LinkReconnecting = 0xFF06,
	LinkClosed = 0xFF07,
	DeviceReady = 0xFF08,
	EmuTradeSessionFinished = 0xFF09,
	EmuSessionStarted = 0xFF0A,
	StatusDebug = 0xFFFF,
};

enum CommandType : uint16_t {
	CmdSetMode = 0x00,
	CmdCancel = 0x01,
	CmdSetModeMaster = 0x10,
	CmdSetModeSlave = 0x11,
	CmdStartHandshake = 0x12,
	CmdConnectLink = 0x13,
	CmdEmuSessionStart = 0xFF0A,
};

enum class Transive { Handshake, Crc, Command };
enum class Handshake { Waiting, Listening, WaitingToRespond, Responding };
enum class Mode { Master, Slave };

const uint32_t IE_REG = 0x200;
const uint32_t IF_REG = 0x202;
const uint16_t SIO_IRQ_MASK = 0x80;

long long nowMs() {
	using namespace std::chrono;
	return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

std::string makeUuid() {
	std::random_device rd;
	std::mt19937_64 gen(((uint64_t) rd() << 32) ^ rd() ^ (uint64_t) std::time(nullptr));
	uint64_t a = gen();
	uint64_t b = gen();
	a = (a & 0xFFFFFFFFFFFF0FFFULL) | 0x0000000000004000ULL;
	b = (b & 0x3FFFFFFFFFFFFFFFULL) | 0x8000000000000000ULL;
	char buf[40];
	snprintf(buf, sizeof(buf), "%08x-%04x-%04x-%04x-%012llx",
	         (unsigned) (a >> 32), (unsigned) ((a >> 16) & 0xFFFF), (unsigned) (a & 0xFFFF),
	         (unsigned) (b >> 48), (unsigned long long) (b & 0xFFFFFFFFFFFFULL));
	return buf;
}

// Tiny lookups for the few fixed JSON shapes the relay sends
size_t findKey(const std::string& json, const char* key) {
	std::string pat = std::string("\"") + key + "\"";
	size_t p = json.find(pat);
	if (p == std::string::npos) {
		return p;
	}
	p = json.find(':', p + pat.size());
	if (p == std::string::npos) {
		return p;
	}
	++p;
	while (p < json.size() && (json[p] == ' ' || json[p] == '\t')) {
		++p;
	}
	return p;
}

bool jsonNumber(const std::string& json, const char* key, long& out) {
	size_t p = findKey(json, key);
	if (p == std::string::npos) {
		return false;
	}
	char* end = nullptr;
	out = strtol(json.c_str() + p, &end, 10);
	return end != json.c_str() + p;
}

bool jsonString(const std::string& json, const char* key, std::string& out) {
	size_t p = findKey(json, key);
	if (p == std::string::npos || p >= json.size() || json[p] != '"') {
		return false;
	}
	size_t e = json.find('"', p + 1);
	if (e == std::string::npos) {
		return false;
	}
	out = json.substr(p + 1, e - p - 1);
	return true;
}

bool jsonNumberArray(const std::string& json, const char* key, std::vector<uint16_t>& out) {
	size_t p = findKey(json, key);
	if (p == std::string::npos || p >= json.size() || json[p] != '[') {
		return false;
	}
	++p;
	out.clear();
	while (p < json.size() && json[p] != ']') {
		if (json[p] == ',' || json[p] == ' ') {
			++p;
			continue;
		}
		char* end = nullptr;
		long v = strtol(json.c_str() + p, &end, 10);
		if (end == json.c_str() + p) {
			return false;
		}
		out.push_back((uint16_t) v);
		p = end - json.c_str();
	}
	return true;
}

std::wstring widen(const std::string& s) {
	return std::wstring(s.begin(), s.end());
}

}

namespace QGBA {

// WinHTTP websocket client. One receiver thread, sends are serialised by the caller.
class CelioWebSocket {
public:
	~CelioWebSocket() { close(); }

	bool open(const std::string& host, int port, bool secure, const std::string& path, std::string& error) {
		m_session = WinHttpOpen(L"mGBA-celio-net/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
		if (!m_session) {
			error = "WinHttpOpen " + std::to_string(GetLastError());
			return false;
		}
		WinHttpSetTimeouts(m_session, 5000, 5000, 5000, 0);
		m_connect = WinHttpConnect(m_session, widen(host).c_str(), (INTERNET_PORT) port, 0);
		if (!m_connect) {
			error = "WinHttpConnect " + std::to_string(GetLastError());
			return false;
		}
		HINTERNET request = WinHttpOpenRequest(m_connect, L"GET", widen(path).c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, secure ? WINHTTP_FLAG_SECURE : 0);
		if (!request) {
			error = "WinHttpOpenRequest " + std::to_string(GetLastError());
			return false;
		}
		if (!WinHttpSetOption(request, WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, nullptr, 0) ||
		    !WinHttpSendRequest(request, WINHTTP_NO_ADDITIONAL_HEADERS, 0, nullptr, 0, 0, 0) ||
		    !WinHttpReceiveResponse(request, nullptr)) {
			error = "WinHttp request " + std::to_string(GetLastError());
			WinHttpCloseHandle(request);
			return false;
		}
		DWORD status = 0;
		DWORD size = sizeof(status);
		WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &size, WINHTTP_NO_HEADER_INDEX);
		if (status != 101) {
			error = "HTTP " + std::to_string(status);
			WinHttpCloseHandle(request);
			return false;
		}
		HINTERNET ws = WinHttpWebSocketCompleteUpgrade(request, 0);
		WinHttpCloseHandle(request);
		if (!ws) {
			error = "WinHttpWebSocketCompleteUpgrade " + std::to_string(GetLastError());
			return false;
		}
		m_ws.store(ws);
		return true;
	}

	bool send(const std::string& text) {
		HINTERNET ws = m_ws.load();
		if (!ws) {
			return false;
		}
		DWORD err = WinHttpWebSocketSend(ws, WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE, (PVOID) text.data(), (DWORD) text.size());
		return err == NO_ERROR;
	}

	bool receive(std::string& out) {
		out.clear();
		char buffer[4096];
		while (true) {
			HINTERNET ws = m_ws.load();
			if (!ws) {
				return false;
			}
			DWORD read = 0;
			WINHTTP_WEB_SOCKET_BUFFER_TYPE type;
			DWORD err = WinHttpWebSocketReceive(ws, buffer, sizeof(buffer), &read, &type);
			if (err != NO_ERROR || type == WINHTTP_WEB_SOCKET_CLOSE_BUFFER_TYPE) {
				return false;
			}
			out.append(buffer, read);
			if (type == WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE || type == WINHTTP_WEB_SOCKET_BINARY_MESSAGE_BUFFER_TYPE) {
				return true;
			}
		}
	}

	// Safe from any thread; makes a blocked receive return
	void close() {
		HINTERNET ws = m_ws.exchange(nullptr);
		if (ws) {
			WinHttpWebSocketClose(ws, WINHTTP_WEB_SOCKET_SUCCESS_CLOSE_STATUS, nullptr, 0);
			WinHttpCloseHandle(ws);
		}
		if (m_connect) {
			WinHttpCloseHandle(m_connect);
			m_connect = nullptr;
		}
		if (m_session) {
			WinHttpCloseHandle(m_session);
			m_session = nullptr;
		}
	}

	void abort() {
		HINTERNET ws = m_ws.exchange(nullptr);
		if (ws) {
			WinHttpCloseHandle(ws);
		}
	}

private:
	HINTERNET m_session = nullptr;
	HINTERNET m_connect = nullptr;
	std::atomic<HINTERNET> m_ws{nullptr};
};

// Port of celio_device.lua (state lives on the core thread only)
struct CelioNet::Device {
	Handshake handshake = Handshake::Waiting;
	Transive transive = Transive::Handshake;
	bool emuReconnect = false;
	bool gbaReconnect = false;
	bool keepAlive = true;
	bool startResponse = false;
	bool startConnect = false;
	std::deque<uint16_t> receivedQueue;
	std::vector<uint16_t> transmitQueue;
	std::deque<uint16_t> currentTx;
	std::vector<uint16_t> currentRx;
	int emptyDirectionStreak = 0;
	uint16_t checksum = 0;
	bool timerEnabled = false;
	int timerCount = 0;
	Mode mode = Mode::Slave;

	void resetState(bool init) {
		Mode keep = mode;
		*this = Device();
		mode = keep;
		if (!init) {
			handshake = Handshake::Listening;
		}
	}
};

CelioNet* CelioNet::instance() {
	static CelioNet net;
	return &net;
}

void CelioNet::log(const std::string& line) {
	if (m_logPath.empty()) {
		return;
	}
	FILE* f = fopen(m_logPath.c_str(), "a");
	if (!f) {
		return;
	}
	fprintf(f, "%lld %s\n", nowMs(), line.c_str());
	fclose(f);
}

void CelioNet::setState(State state, const std::string& message) {
	{
		std::lock_guard<std::mutex> lock(m_stateLock);
		m_state = state;
		m_message = message;
	}
	log("state " + std::to_string((int) state) + " " + message);
}

void CelioNet::setMessage(const std::string& message) {
	std::lock_guard<std::mutex> lock(m_stateLock);
	m_message = message;
}

CelioNet::Snapshot CelioNet::snapshot() {
	std::lock_guard<std::mutex> lock(m_stateLock);
	return Snapshot{m_state, m_room, m_message, m_net.joinable()};
}

bool CelioNet::start(std::shared_ptr<CoreController> controller, const std::string& room) {
	stop();
	if (!controller || controller->platform() != mPLATFORM_GBA) {
		setState(State::Error, "ゲームを起動してから使ってください");
		return false;
	}
	const char* logPath = getenv("MGBA_CELIO_NET_LOG");
	m_logPath = logPath ? logPath : "";
	m_controller = controller;
	m_joinRoom = room;
	{
		std::lock_guard<std::mutex> lock(m_stateLock);
		m_room = room;
	}
	m_stopping = false;
	m_connected = false;
	m_inSession = false;
	m_sessionAck = -1;
	m_nextAck = 0;
	m_outSequence = 0;
	m_expectedSequence = 0;
	m_buffered.clear();
	m_seenCommands.clear();
	m_outgoing.clear();
	m_incoming.clear();
	m_hasIncoming = false;
	m_linkStartAt = 0;
	m_clientId = makeUuid();

	{
		CoreController::Interrupter interrupter(m_controller);
		attachCore();
	}
	setState(State::Connecting, "サーバーに つないでいます…");
	m_net = std::thread(&CelioNet::netThread, this);
	m_work = std::thread(&CelioNet::workThread, this);
	return true;
}

void CelioNet::stop(bool touchCore) {
	m_stopping = true;
	if (m_connected && m_inSession) {
		sendText("42[\"sessionLeft\"]");
	}
	{
		std::lock_guard<std::mutex> lock(m_wsLock);
		if (m_ws) {
			m_ws->abort();
		}
	}
	m_outCond.notify_all();
	if (m_net.joinable()) {
		m_net.join();
	}
	if (m_work.joinable()) {
		m_work.join();
	}
	{
		std::lock_guard<std::mutex> lock(m_wsLock);
		m_ws.reset();
	}
	m_deviceOn = false;
	if (m_controller) {
		if (m_attached && touchCore) {
			CoreController::Interrupter interrupter(m_controller);
			detachCore();
		} else if (m_attached.exchange(false)) {
			m_gba = nullptr;
			m_device.reset();
		}
		m_controller.reset();
	}
	std::lock_guard<std::mutex> lock(m_stateLock);
	if (m_state != State::Error && m_state != State::Finished) {
		m_state = State::Idle;
		m_message.clear();
	}
}

// ---- core side ---------------------------------------------------------------

void CelioNet::attachCore() {
	mCore* core = m_controller->thread()->core;
	m_gba = static_cast<GBA*>(core->board);
	if (!m_callbacksAdded || m_callbackCore != core) {
		mCoreCallbacks callbacks{};
		callbacks.context = this;
		callbacks.vblankIRQ = &CelioNet::vblankHook;
		callbacks.timer3IRQ = &CelioNet::timer3Hook;
		core->addCoreCallbacks(core, &callbacks);
		m_callbacksAdded = true;
		m_callbackCore = core;
	}
	if (!m_mask) {
		m_mask.reset(new mSioMask);
	}
	m_mask->mask = 0xFFFF;
	m_oldMask = m_gba->sioMask;
	m_gba->sioMask = m_mask.get();
	m_gba->sioReadHookContext = this;
	m_gba->sioReadHook = &CelioNet::sioReadHook;
	m_device.reset(new Device);
	m_resetRequested = false;
	m_attached = true;
}

void CelioNet::detachCore() {
	if (!m_attached.exchange(false)) {
		return;
	}
	if (m_gba) {
		if (m_gba->sioMask == m_mask.get()) {
			m_gba->sioMask = m_oldMask;
		}
		m_gba->sioReadHook = nullptr;
		m_gba->sioReadHookContext = nullptr;
		if (m_device && m_device->timerEnabled) {
			GBAIOWrite(m_gba, GBA_REG_TM3CNT_HI, 0);
			GBAIOWrite(m_gba, GBA_REG_TM3CNT_LO, 0);
		}
	}
	m_device.reset();
}

void CelioNet::setSioMask(uint16_t mask) {
	m_mask->mask = mask;
}

void CelioNet::pushIncoming(Incoming in) {
	std::lock_guard<std::mutex> lock(m_inLock);
	m_incoming.push_back(std::move(in));
	m_hasIncoming = true;
}

void CelioNet::emitStatus(uint16_t status) {
	log("device status " + std::to_string(status));
	switch (status) {
	case LinkConnected:
		setState(State::Connected, "つながりました（通信中）");
		break;
	case LinkClosed:
		setMessage("通信を おえています…");
		break;
	default:
		break;
	}
	// LinkExchangeSession.handleDeviceStatusToSocket
	if (status == DeviceReady || status == EmuTradeSessionFinished || status == StatusDebug) {
		return;
	}
	std::lock_guard<std::mutex> lock(m_outLock);
	m_outgoing.push_back(Outgoing{true, status, {}});
	m_outCond.notify_all();
}

void CelioNet::emitData(const std::vector<uint16_t>& data) {
	std::lock_guard<std::mutex> lock(m_outLock);
	m_outgoing.push_back(Outgoing{false, 0, data});
	m_outCond.notify_all();
}

void CelioNet::drainIncoming() {
	if (m_resetRequested.exchange(false) && m_device) {
		m_device->resetState(true);
		m_device->mode = Mode::Slave;
		m_mask->mask = 0xFFFF;
	}
	if (!m_hasIncoming) {
		return;
	}
	std::deque<Incoming> items;
	{
		std::lock_guard<std::mutex> lock(m_inLock);
		items.swap(m_incoming);
		m_hasIncoming = false;
	}
	Device* d = m_device.get();
	if (!d) {
		return;
	}
	for (Incoming& in : items) {
		if (!in.isCommand) {
			// celio_device:receive_data
			for (uint16_t v : in.data) {
				d->receivedQueue.push_back(v);
			}
			continue;
		}
		// celio_device:receive_command
		switch (in.command) {
		case CmdSetMode:
			log("device command SetMode");
			emitStatus(DeviceReady);
			emitStatus(AwaitMode);
			break;
		case CmdEmuSessionStart:
			emitStatus(AwaitMode);
			break;
		case CmdSetModeSlave:
			log("device command SetModeSlave");
			d->handshake = Handshake::Listening;
			d->mode = Mode::Slave;
			setSioMask(0x600B);
			break;
		case CmdSetModeMaster:
			log("device command SetModeMaster");
			d->handshake = Handshake::Listening;
			d->mode = Mode::Master;
			setSioMask(0x601F);
			break;
		case CmdStartHandshake:
			log("device command StartHandshake");
			d->startResponse = true;
			break;
		case CmdConnectLink:
			log("device command ConnectLink");
			d->startConnect = true;
			break;
		default:
			log("device unknown command " + std::to_string(in.command));
			break;
		}
	}
}

static void writeIo(GBA* gba, uint32_t reg, uint16_t value) {
	gba->memory.io[reg >> 1] = value;
}

static uint16_t readIo(GBA* gba, uint32_t reg) {
	return gba->memory.io[reg >> 1];
}

void CelioNet::sioReadHook(void* context) {
	CelioNet* self = static_cast<CelioNet*>(context);
	if (!self->m_attached) {
		return;
	}
	self->drainIncoming();
	Device* d = self->m_device.get();
	if (!d || !self->m_deviceOn) {
		return;
	}
	GBA* gba = self->m_gba;
	uint16_t rx = readIo(gba, 0x12A);
	uint16_t tx = 0;

	switch (d->transive) {
	case Transive::Handshake: {
		// transive_handshake
		bool done = false;
		if (rx == 0xB9A0 && d->handshake == Handshake::Listening) {
			self->emitStatus(HandshakeReceived);
			d->handshake = Handshake::WaitingToRespond;
		}
		if (d->startConnect) {
			self->emitStatus(LinkConnected);
			d->transive = Transive::Crc;
			tx = 0x8FFF;
			done = true;
		}
		if (!done) {
			if (rx == 0x8FFF) {
				self->emitStatus(LinkConnected);
				d->transive = Transive::Crc;
			}
			if (d->handshake == Handshake::Responding) {
				tx = 0xB9A0;
			} else {
				if (d->startResponse) {
					d->handshake = Handshake::Responding;
				}
				tx = 0xD15E;
			}
		}
		break;
	}
	case Transive::Crc: {
		// transive_crc
		auto flush = [self, d]() {
			std::vector<uint16_t> data(d->transmitQueue.begin(), d->transmitQueue.end());
			data.resize(32, 0);
			d->transmitQueue.clear();
			self->emitData(data);
		};
		if (d->emuReconnect && d->gbaReconnect) {
			flush();
			if (d->keepAlive) {
				self->log("device reconnecting");
				self->emitStatus(LinkReconnecting);
				d->resetState(false);
			} else {
				self->log("device link closed");
				self->emitStatus(LinkClosed);
			}
			if (d->timerEnabled) {
				d->timerEnabled = false;
			}
			d->timerCount = 0;
			GBAIOWrite(gba, GBA_REG_TM3CNT_HI, 0);
			GBAIOWrite(gba, GBA_REG_TM3CNT_LO, 0);
		} else {
			d->transive = Transive::Command;
		}
		tx = d->checksum;
		d->checksum = 0;
		break;
	}
	case Transive::Command: {
		// transive_command
		d->currentRx.push_back(rx);
		if (d->currentTx.empty()) {
			// load_tx_command
			if (d->receivedQueue.empty()) {
				d->currentTx.assign(8, 0);
			} else {
				for (int i = 0; i < 8 && !d->receivedQueue.empty(); ++i) {
					d->currentTx.push_back(d->receivedQueue.front());
					d->receivedQueue.pop_front();
				}
			}
			if (d->currentTx.size() >= 2 && d->currentTx[0] == 0xCAFE && d->currentTx[1] == 0x0017) {
				d->keepAlive = false;
			}
			if (d->currentTx[0] == 0x5FFF) {
				self->log("partner ready for reconnect");
				d->emuReconnect = true;
			}
		}
		if (d->currentRx.size() == 8) {
			if (d->currentRx[0] == 0x5FFF) {
				self->log("ready for reconnect");
				d->gbaReconnect = true;
			}
			// save_rx_command
			if (d->currentRx[0] == 0xCAFE && d->currentRx[1] == 0x0011) {
				++d->emptyDirectionStreak;
				if (d->emptyDirectionStreak > 1) {
					d->currentRx[0] = 0;
					d->currentRx[1] = 0;
				}
			} else {
				d->emptyDirectionStreak = 0;
			}
			bool queue = !d->transmitQueue.empty();
			for (uint16_t v : d->currentRx) {
				if (v) {
					queue = true;
					break;
				}
			}
			if (queue) {
				d->transmitQueue.insert(d->transmitQueue.end(), d->currentRx.begin(), d->currentRx.end());
			}
			d->currentRx.clear();
			d->transive = Transive::Crc;
		}
		if (d->transmitQueue.size() >= 32) {
			std::vector<uint16_t> data(d->transmitQueue.begin(), d->transmitQueue.end());
			data.resize(32, 0);
			d->transmitQueue.clear();
			self->emitData(data);
		}
		tx = d->currentTx.front();
		d->currentTx.pop_front();
		d->checksum = (uint16_t) (d->checksum + tx);
		d->checksum = (uint16_t) (d->checksum + rx);
		break;
	}
	}

	if (d->mode == Mode::Master) {
		writeIo(gba, 0x120, tx);
		writeIo(gba, 0x122, rx);
	} else {
		writeIo(gba, 0x120, rx);
		writeIo(gba, 0x122, tx);
	}
	writeIo(gba, 0x124, 0xFFFF);
	writeIo(gba, 0x126, 0xFFFF);
}

void CelioNet::vblankHook(void* context) {
	CelioNet* self = static_cast<CelioNet*>(context);
	if (!self->m_attached) {
		return;
	}
	self->drainIncoming();
	Device* d = self->m_device.get();
	if (!d || !self->m_deviceOn) {
		return;
	}
	GBA* gba = self->m_gba;
	// sync_timer
	uint16_t ie = readIo(gba, IE_REG);
	if (d->mode == Mode::Slave || !(ie & SIO_IRQ_MASK)) {
		if (d->timerEnabled) {
			d->timerEnabled = false;
			d->timerCount = 0;
			GBAIOWrite(gba, GBA_REG_TM3CNT_HI, 0);
			GBAIOWrite(gba, GBA_REG_TM3CNT_LO, 0);
		}
		return;
	}
	writeIo(gba, IF_REG, readIo(gba, IF_REG) | SIO_IRQ_MASK);
	if (d->transive == Transive::Crc && !d->timerEnabled) {
		d->timerEnabled = true;
		GBAIOWrite(gba, GBA_REG_TM3CNT_LO, 0xFED0);
		GBAIOWrite(gba, GBA_REG_TM3CNT_HI, 0x00C1);
	}
}

void CelioNet::timer3Hook(void* context) {
	CelioNet* self = static_cast<CelioNet*>(context);
	if (!self->m_attached) {
		return;
	}
	Device* d = self->m_device.get();
	if (!d || !self->m_deviceOn) {
		return;
	}
	GBA* gba = self->m_gba;
	// transmission_timer
	uint16_t ie = readIo(gba, IE_REG);
	if (d->mode == Mode::Slave || !(ie & SIO_IRQ_MASK)) {
		return;
	}
	writeIo(gba, IF_REG, (readIo(gba, IF_REG) & 0xFFBF) | SIO_IRQ_MASK);
	if (d->timerCount == 7) {
		d->timerEnabled = false;
		d->timerCount = 0;
		GBAIOWrite(gba, GBA_REG_TM3CNT_HI, 0);
		GBAIOWrite(gba, GBA_REG_TM3CNT_LO, 0);
	} else {
		++d->timerCount;
	}
}

// ---- network side ------------------------------------------------------------

bool CelioNet::sendText(const std::string& text) {
	std::lock_guard<std::mutex> lock(m_wsLock);
	if (!m_ws) {
		return false;
	}
	return m_ws->send(text);
}

bool CelioNet::connectOnce(bool first) {
	std::string host = "celio-server.up.railway.app";
	int port = 443;
	bool secure = true;
	// MGBA_CELIO_NET_SERVER=host:port (plain ws, for a self-hosted Celio-Server)
	const char* server = getenv("MGBA_CELIO_NET_SERVER");
	if (server && *server) {
		std::string s = server;
		size_t colon = s.rfind(':');
		host = s.substr(0, colon);
		port = colon == std::string::npos ? 80 : atoi(s.c_str() + colon + 1);
		secure = false;
	}
	std::unique_ptr<CelioWebSocket> ws(new CelioWebSocket);
	std::string error;
	if (!ws->open(host, port, secure, "/socket.io/?EIO=4&transport=websocket", error)) {
		log("connect failed: " + error);
		return false;
	}
	{
		std::lock_guard<std::mutex> lock(m_wsLock);
		m_ws = std::move(ws);
	}
	log(first ? "connected" : "reconnected");
	m_lastReceive = nowMs();
	return true;
}

void CelioNet::netThread() {
	int failures = 0;
	bool first = true;
	while (!m_stopping) {
		if (!connectOnce(first)) {
			if (++failures > 5) {
				setState(State::Error, "サーバーに つながりません");
				break;
			}
			std::this_thread::sleep_for(std::chrono::milliseconds(500));
			continue;
		}
		first = false;
		failures = 0;
		std::string msg;
		while (!m_stopping) {
			CelioWebSocket* ws;
			{
				std::lock_guard<std::mutex> lock(m_wsLock);
				ws = m_ws.get();
			}
			if (!ws || !ws->receive(msg)) {
				break;
			}
			m_lastReceive = nowMs();
			handleMessage(msg);
		}
		m_connected = false;
		{
			std::lock_guard<std::mutex> lock(m_wsLock);
			if (m_ws) {
				m_ws->abort();
			}
		}
		State state = snapshot().state;
		if (m_stopping || state == State::Finished || state == State::Error) {
			break;
		}
		log("connection lost, retrying");
		std::this_thread::sleep_for(std::chrono::milliseconds(200));
	}
	m_connected = false;
	m_outCond.notify_all();
}

void CelioNet::handleMessage(const std::string& msg) {
	if (msg.empty()) {
		return;
	}
	switch (msg[0]) {
	case '0': // engine.io open
		sendText("40{\"clientId\":\"" + m_clientId + "\"}");
		return;
	case '2': // ping
		sendText("3");
		return;
	case '1':
		{
			std::lock_guard<std::mutex> lock(m_wsLock);
			if (m_ws) {
				m_ws->abort();
			}
		}
		return;
	case '4':
		break;
	default:
		return;
	}
	if (msg.size() < 2) {
		return;
	}
	char type = msg[1];
	size_t i = 2;
	long id = -1;
	if (i < msg.size() && msg[i] >= '0' && msg[i] <= '9') {
		id = 0;
		while (i < msg.size() && msg[i] >= '0' && msg[i] <= '9') {
			id = id * 10 + (msg[i] - '0');
			++i;
		}
	}
	std::string rest = msg.substr(i);
	switch (type) {
	case '0': // socket.io connect
		m_connected = true;
		if (!m_inSession && m_sessionAck == -1) {
			m_sessionAck = m_nextAck++;
			if (m_joinRoom.empty()) {
				setMessage("へやを つくっています…");
				sendText("42" + std::to_string(m_sessionAck) + "[\"sessionCreate\",null]");
			} else {
				setMessage("へや " + m_joinRoom + " に はいっています…");
				sendText("42" + std::to_string(m_sessionAck) + "[\"sessionJoin\",\"" + m_joinRoom + "\"]");
			}
		}
		m_outCond.notify_all();
		break;
	case '4': // connect error
		log("connect error " + rest);
		setState(State::Error, "サーバーに はいれませんでした");
		m_stopping = true;
		break;
	case '1':
		{
			std::lock_guard<std::mutex> lock(m_wsLock);
			if (m_ws) {
				m_ws->abort();
			}
		}
		break;
	case '2':
		handleEvent(rest, id);
		break;
	case '3':
		handleAck(id, rest);
		break;
	default:
		break;
	}
}

void CelioNet::handleAck(long id, const std::string& json) {
	if (id != m_sessionAck) {
		return;
	}
	m_sessionAck = -2;
	log("session reply " + json);
	std::string variant;
	jsonString(json, "variant", variant);
	if (variant != "Ok") {
		std::string error;
		jsonString(json, "error", error);
		std::string message = "へやに はいれませんでした";
		if (error == "Session not found") {
			message = "その番号の へやは ありません";
		} else if (error == "Session is full") {
			message = "その へやは もう 2 人 はいっています";
		}
		setState(State::Error, message);
		m_stopping = true;
		std::lock_guard<std::mutex> lock(m_wsLock);
		if (m_ws) {
			m_ws->abort();
		}
		return;
	}
	std::string room;
	jsonString(json, "id", room);
	{
		std::lock_guard<std::mutex> lock(m_stateLock);
		m_room = room;
	}
	m_inSession = true;
	m_deviceOn = true;
	if (m_joinRoom.empty()) {
		setState(State::WaitingPartner, "へやの 番号を 相手に つたえて、まってください");
	} else {
		setState(State::Linking, "相手と つながりました。通信の じゅんびを しています…");
		startLinkMode();
	}
}

void CelioNet::handleEvent(const std::string& json, long ackId) {
	std::string name;
	if (json.size() < 3 || json[0] != '[' || json[1] != '"') {
		return;
	}
	size_t e = json.find('"', 2);
	if (e == std::string::npos) {
		return;
	}
	name = json.substr(2, e - 2);

	if (name == "deviceData") {
		if (ackId >= 0) {
			sendText("43" + std::to_string(ackId) + "[true]");
		}
		long sequence = 0;
		std::vector<uint16_t> data;
		if (jsonNumber(json, "sequence", sequence) && jsonNumberArray(json, "data", data)) {
			deliverData(sequence, std::move(data));
		}
	} else if (name == "deviceCommand") {
		std::string uuid;
		long command = 0;
		jsonString(json, "uuid", uuid);
		if (!jsonNumber(json, "command", command)) {
			return;
		}
		if (!uuid.empty()) {
			if (m_seenCommands.count(uuid)) {
				return;
			}
			m_seenCommands.insert(uuid);
		}
		log("server command " + std::to_string(command));
		pushIncoming(Incoming{true, (uint16_t) command, {}});
	} else if (name == "partnerJoined") {
		setState(State::Linking, "相手が はいりました。通信の じゅんびを しています…");
		m_resetRequested = true;
		m_expectedSequence = 0;
		m_buffered.clear();
		{
			std::lock_guard<std::mutex> lock(m_outLock);
			m_outgoing.clear();
			m_outSequence = 0;
		}
		startLinkMode();
	} else if (name == "partnerLeft") {
		setState(State::WaitingPartner, "相手が ぬけました。へやの 番号を つたえて、まってください");
		std::lock_guard<std::mutex> lock(m_outLock);
		m_linkStartAt = 0;
	} else if (name == "sessionClose") {
		m_inSession = false;
		m_deviceOn = false;
		setState(State::Finished, "通信が おわりました");
		m_stopping = true;
		std::lock_guard<std::mutex> lock(m_wsLock);
		if (m_ws) {
			m_ws->abort();
		}
	}
}

void CelioNet::deliverData(long sequence, std::vector<uint16_t> data) {
	// LinkExchangeSession.handleSocketDataToDevice
	if (sequence < m_expectedSequence) {
		return;
	}
	if (sequence > m_expectedSequence) {
		m_buffered[sequence] = std::move(data);
		return;
	}
	pushIncoming(Incoming{false, 0, std::move(data)});
	++m_expectedSequence;
	auto it = m_buffered.find(m_expectedSequence);
	while (it != m_buffered.end()) {
		pushIncoming(Incoming{false, 0, std::move(it->second)});
		m_buffered.erase(it);
		++m_expectedSequence;
		it = m_buffered.find(m_expectedSequence);
	}
}

void CelioNet::startLinkMode() {
	// LinkDeviceUtils.tryEnableLinkMode: Cancel, wait 500 ms, SetMode
	pushIncoming(Incoming{true, CmdCancel, {}});
	std::lock_guard<std::mutex> lock(m_outLock);
	m_linkStartAt = nowMs() + 500;
	m_outCond.notify_all();
}

void CelioNet::workThread() {
	std::unique_lock<std::mutex> lock(m_outLock);
	while (!m_stopping) {
		m_outCond.wait_for(lock, std::chrono::milliseconds(50));
		if (m_stopping) {
			break;
		}
		long long now = nowMs();
		if (m_linkStartAt && now >= m_linkStartAt) {
			m_linkStartAt = 0;
			lock.unlock();
			pushIncoming(Incoming{true, CmdSetMode, {}});
			lock.lock();
		}
		if (m_connected && now - m_lastReceive > 6000) {
			// The relay pings every 500 ms; silence means the socket is dead
			lock.unlock();
			log("receive timeout");
			{
				std::lock_guard<std::mutex> wsLock(m_wsLock);
				if (m_ws) {
					m_ws->abort();
				}
			}
			lock.lock();
			continue;
		}
		while (m_connected && m_inSession && !m_outgoing.empty()) {
			Outgoing item = m_outgoing.front();
			std::string text;
			if (item.isStatus) {
				text = "42[\"deviceStatus\",{\"uuid\":\"" + makeUuid() + "\",\"linkStatus\":" + std::to_string(item.status) + "}]";
			} else {
				text = "42[\"deviceData\",{\"sequence\":" + std::to_string(m_outSequence) + ",\"data\":[";
				for (size_t i = 0; i < item.data.size(); ++i) {
					if (i) {
						text += ",";
					}
					text += std::to_string(item.data[i]);
				}
				text += "]}]";
			}
			lock.unlock();
			bool ok = sendText(text);
			lock.lock();
			if (!ok) {
				break;
			}
			if (!item.isStatus) {
				++m_outSequence;
			}
			if (!m_outgoing.empty()) {
				m_outgoing.pop_front();
			}
		}
	}
}

}
