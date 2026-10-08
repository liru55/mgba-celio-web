/* Net link over the public Celio relay, built into the Qt frontend (Windows only).
 *
 * Replaces the two pieces that used to be needed next to mGBA celio edition:
 *  - the Celio-mGBA-Link Lua script (emulated Celio device on the SIO port)
 *  - the Celio web page (Socket.IO client that talks to the relay server)
 * The device logic is a straight port of celio_device.lua (Celio-mGBA-Link 0.2) so that
 * both sides behave the same as the script + page combination.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

struct GBA;
struct mCore;
struct mSioMask;

namespace QGBA {

class CoreController;
class CelioWebSocket;

class CelioNet {
public:
	enum class State {
		Idle,
		Connecting,
		WaitingPartner,
		Linking,
		Connected,
		Finished,
		Error,
	};

	struct Snapshot {
		State state;
		std::string room;
		std::string message;
		bool active;
	};

	static CelioNet* instance();

	// GUI thread. room is empty to create a new room.
	bool start(std::shared_ptr<CoreController> controller, const std::string& room);
	// touchCore = false when the core is going away (CoreController::stopping)
	void stop(bool touchCore = true);
	Snapshot snapshot();

	// Core thread entry points (registered on the core)
	static void sioReadHook(void* context);
	static void vblankHook(void* context);
	static void timer3Hook(void* context);

private:
	CelioNet() = default;

	struct Device;
	struct Outgoing {
		bool isStatus;
		uint16_t status;
		std::vector<uint16_t> data;
	};
	struct Incoming {
		bool isCommand;
		uint16_t command;
		std::vector<uint16_t> data;
	};

	// core side
	void attachCore();
	void detachCore();
	void drainIncoming();
	void emitStatus(uint16_t status);
	void emitData(const std::vector<uint16_t>& data);
	void setSioMask(uint16_t mask);

	// network side
	void netThread();
	void workThread();
	bool connectOnce(bool first);
	void handleMessage(const std::string& msg);
	void handleEvent(const std::string& json, long ackId);
	void handleAck(long id, const std::string& json);
	bool sendText(const std::string& text);
	void startLinkMode();
	void pushIncoming(Incoming in);
	void deliverData(long sequence, std::vector<uint16_t> data);

	void setState(State state, const std::string& message);
	void setMessage(const std::string& message);
	void log(const std::string& line);

	std::mutex m_stateLock;
	State m_state = State::Idle;
	std::string m_room;
	std::string m_message;

	std::shared_ptr<CoreController> m_controller;
	GBA* m_gba = nullptr;
	mSioMask* m_oldMask = nullptr;
	std::unique_ptr<mSioMask> m_mask;
	std::atomic<bool> m_attached{false};
	std::atomic<bool> m_deviceOn{false};
	std::unique_ptr<Device> m_device;
	bool m_callbacksAdded = false;
	mCore* m_callbackCore = nullptr;

	std::mutex m_inLock;
	std::deque<Incoming> m_incoming;
	std::atomic<bool> m_hasIncoming{false};
	std::atomic<bool> m_resetRequested{false};

	std::mutex m_outLock;
	std::condition_variable m_outCond;
	std::deque<Outgoing> m_outgoing;
	long m_outSequence = 0;
	long long m_linkStartAt = 0;

	long m_expectedSequence = 0;
	std::map<long, std::vector<uint16_t>> m_buffered;
	std::set<std::string> m_seenCommands;

	std::unique_ptr<CelioWebSocket> m_ws;
	std::mutex m_wsLock;
	std::thread m_net;
	std::thread m_work;
	std::atomic<bool> m_stopping{false};
	std::atomic<bool> m_connected{false};
	std::atomic<long long> m_lastReceive{0};
	std::string m_clientId;
	std::string m_joinRoom;
	bool m_inSession = false;
	long m_nextAck = 0;
	long m_sessionAck = -1;
	std::string m_logPath;
};

}
