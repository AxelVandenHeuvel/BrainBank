import time

from backend.session.memory import SessionMemory, SessionTurn


class TestSessionMemory:
    def test_add_and_get_turns(self):
        mem = SessionMemory()
        mem.add_turn("s1", "user", "What is calculus?")
        mem.add_turn("s1", "assistant", "Calculus studies change.")

        turns = mem.get_turns("s1")
        assert len(turns) == 2
        assert turns[0].role == "user"
        assert turns[0].content == "What is calculus?"
        assert turns[1].role == "assistant"
        assert turns[1].content == "Calculus studies change."

    def test_get_turns_empty_session(self):
        mem = SessionMemory()
        assert mem.get_turns("nonexistent") == []

    def test_get_turns_respects_max_turns(self):
        mem = SessionMemory(max_turns=4)
        for i in range(6):
            mem.add_turn("s1", "user", f"Message {i}")

        turns = mem.get_turns("s1")
        assert len(turns) == 4
        assert turns[0].content == "Message 2"
        assert turns[-1].content == "Message 5"

    def test_sessions_are_isolated(self):
        mem = SessionMemory()
        mem.add_turn("s1", "user", "Session 1 message")
        mem.add_turn("s2", "user", "Session 2 message")

        s1_turns = mem.get_turns("s1")
        s2_turns = mem.get_turns("s2")
        assert len(s1_turns) == 1
        assert len(s2_turns) == 1
        assert s1_turns[0].content == "Session 1 message"
        assert s2_turns[0].content == "Session 2 message"

    def test_clear_session(self):
        mem = SessionMemory()
        mem.add_turn("s1", "user", "Hello")
        mem.clear_session("s1")
        assert mem.get_turns("s1") == []

    def test_clear_nonexistent_session_is_noop(self):
        mem = SessionMemory()
        mem.clear_session("nonexistent")  # Should not raise

    def test_ttl_expiration(self):
        mem = SessionMemory(ttl_seconds=0.1)
        mem.add_turn("s1", "user", "Hello")
        assert len(mem.get_turns("s1")) == 1

        time.sleep(0.15)
        mem.cleanup_expired()
        assert mem.get_turns("s1") == []

    def test_active_session_not_expired(self):
        mem = SessionMemory(ttl_seconds=10)
        mem.add_turn("s1", "user", "Hello")
        mem.cleanup_expired()
        assert len(mem.get_turns("s1")) == 1

    def test_turn_has_timestamp(self):
        mem = SessionMemory()
        before = time.time()
        mem.add_turn("s1", "user", "Hello")
        after = time.time()

        turn = mem.get_turns("s1")[0]
        assert before <= turn.timestamp <= after

    def test_max_turns_trims_oldest(self):
        mem = SessionMemory(max_turns=2)
        mem.add_turn("s1", "user", "First")
        mem.add_turn("s1", "assistant", "Reply")
        mem.add_turn("s1", "user", "Second")

        turns = mem.get_turns("s1")
        assert len(turns) == 2
        assert turns[0].content == "Reply"
        assert turns[1].content == "Second"
